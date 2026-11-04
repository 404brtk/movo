import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maxImportBytes } from "../../shared/contracts/media.ts";
import { createMediaTools } from "../media-tools/tools.ts";
import { runCommand } from "./command.ts";
import { createYoutubeDownloader } from "./ytdlp.ts";

vi.mock("./command.ts", () => ({ runCommand: vi.fn<typeof runCommand>() }));
const command = vi.mocked(runCommand);
const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const metadata = {
  id: "aaaaaaaaaaa",
  title: "A public video",
  duration: 2,
  live_status: "not_live",
};
afterEach(() => vi.resetAllMocks());

describe("YouTube downloader protocol", () => {
  it("allows unknown duration and passes a normalized URL as a single argument", async () => {
    command.mockReturnValue(Effect.succeed(JSON.stringify({ ...metadata, duration: null })));
    const downloader = createYoutubeDownloader(
      "yt-dlp",
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    expect(
      await Effect.runPromise(downloader.preview("https://youtu.be/aaaaaaaaaaa?t=10")),
    ).toEqual({ url, title: metadata.title, durationSeconds: null });
    expect(command.mock.calls[0]?.[1].slice(-2)).toEqual(["--", url]);
    expect(command.mock.calls[0]?.[1]).toContain("--no-remote-components");
  });

  it.each([
    { ...metadata, id: "bbbbbbbbbbb" },
    { ...metadata, live_status: "is_live" },
    { ...metadata, live_status: "is_upcoming" },
    { ...metadata, _type: "playlist" },
    { ...metadata, title: "" },
    { ...metadata, duration: -1 },
  ])("rejects unsupported or invalid source metadata: %j", async (invalid) => {
    command.mockReturnValue(Effect.succeed(JSON.stringify(invalid)));
    const downloader = createYoutubeDownloader(
      "yt-dlp",
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    await expect(Effect.runPromise(downloader.preview(url))).rejects.toMatchObject({
      reason: "unsupported",
    });
  });

  it("reads structured progress across streams and uses only freshly inspected source information", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-protocol-"));
    const tools = createMediaTools({ dataDirectory: directory });
    const updates: unknown[] = [];
    try {
      const path = join(directory, "media.mp4");
      command.mockReturnValueOnce(Effect.succeed(JSON.stringify(metadata)));
      command.mockImplementationOnce((_file, _args, options) =>
        Effect.promise(async () => {
          expect(JSON.parse(await readFile(join(directory, "source.info.json"), "utf8"))).toEqual(
            metadata,
          );
          options.onLine?.('MOVO_PROGRESS:{"downloaded_bytes":100,"filename":"video"}');
          options.onLine?.('MOVO_PROGRESS:{"downloaded_bytes":30,"filename":"audio"}');
          options.onLine?.("MOVO_PROCESSING");
          await writeFile(path, "completed fixture");
          options.onLine?.(`MOVO_FILE:${JSON.stringify(path)}`);
          return "";
        }),
      );
      const result = await Effect.runPromise(
        createYoutubeDownloader("yt-dlp", tools).download(url, directory, (update) =>
          updates.push(update),
        ),
      );
      expect(result.path).toBe(path);
      expect(updates).toContainEqual({ downloadedBytes: 130, phase: "downloading" });
      expect(updates.at(-1)).toEqual({ phase: "processing" });
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects oversized combined streams before publishing a file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-limit-"));
    const tools = createMediaTools({ dataDirectory: directory });
    try {
      command.mockReturnValueOnce(Effect.succeed(JSON.stringify(metadata)));
      command.mockImplementationOnce((_file, _args, options) =>
        Effect.sync(() => {
          options.onLine?.(`MOVO_PROGRESS:{"downloaded_bytes":${maxImportBytes + 1}}`);
          return "";
        }),
      );
      await expect(
        Effect.runPromise(
          createYoutubeDownloader("yt-dlp", tools).download(url, directory, vi.fn()),
        ),
      ).rejects.toMatchObject({ reason: "tooLarge" });
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });
});
