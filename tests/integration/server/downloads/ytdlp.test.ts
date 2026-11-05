import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maxImportBytes } from "../../../../src/shared/contracts/media.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { runCommand } from "../../../../src/server/process/command.ts";
import { createMediaDownloader } from "../../../../src/server/downloads/ytdlp.ts";

vi.mock("../../../../src/server/process/command.ts", () => ({
  runCommand: vi.fn<typeof runCommand>(),
}));
const command = vi.mocked(runCommand);
const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const metadata = {
  id: "aaaaaaaaaaa",
  title: "A public video",
  duration: 2,
  live_status: "not_live",
};
const xUrl = "https://x.com/i/web/status/123";
const xMetadata = {
  ...metadata,
  id: "456",
  display_id: "123",
  extractor_key: "Twitter",
};
afterEach(() => vi.resetAllMocks());

describe("Media downloader protocol", () => {
  it("previews an X post using its post identity rather than its media ID", async () => {
    command.mockReturnValue(Effect.succeed(JSON.stringify(xMetadata)));
    const downloader = createMediaDownloader(
      "yt-dlp",
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    expect(
      await Effect.runPromise(downloader.preview("https://twitter.com/example/status/123?s=20")),
    ).toEqual({ url: xUrl, title: xMetadata.title, durationSeconds: 2 });
    expect(command.mock.calls[0]?.[1].slice(-2)).toEqual(["--", xUrl]);
    expect(command.mock.calls[0]?.[1]).toContain("twitter");
  });

  it.each([
    { ...xMetadata, display_id: "124" },
    { ...xMetadata, display_id: undefined },
    { ...xMetadata, extractor_key: "Youtube" },
    { ...xMetadata, extractor_key: "TwitterBroadcast", id: "broadcast-id" },
    { ...xMetadata, _type: "playlist", entries: [xMetadata, xMetadata] },
    { ...xMetadata, live_status: "is_live" },
  ])("rejects X results outside the requested single native video: %j", async (invalid) => {
    command.mockReturnValue(Effect.succeed(JSON.stringify(invalid)));
    const downloader = createMediaDownloader(
      "yt-dlp",
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    await expect(Effect.runPromise(downloader.preview(xUrl))).rejects.toMatchObject({
      reason: "unsupported",
    });
  });

  it("extracts X audio with a combined-stream fallback and reports the final audio file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-x-audio-"));
    const tools = createMediaTools({ dataDirectory: directory });
    try {
      command.mockReturnValueOnce(Effect.succeed(JSON.stringify(xMetadata)));
      command.mockImplementationOnce((_file, args, options) =>
        Effect.promise(async () => {
          expect(args[args.indexOf("--format") + 1]).toBe("ba/b");
          expect(args).toContain("--extract-audio");
          expect(args[args.indexOf("--audio-format") + 1]).toBe("best");
          expect(args).toContain("--ffmpeg-location");
          expect(args).not.toContain("--merge-output-format");
          const path = join(directory, "media.m4a");
          await writeFile(path, "extracted source audio");
          options.onLine?.("MOVO_PROCESSING");
          options.onLine?.(`MOVO_FILE:${JSON.stringify(path)}`);
          return "";
        }),
      );
      const result = await Effect.runPromise(
        createMediaDownloader("yt-dlp", tools).download(xUrl, directory, () => undefined, "audio"),
      );
      expect(result).toEqual({
        path: join(directory, "media.m4a"),
        preview: { url: xUrl, title: xMetadata.title, durationSeconds: 2 },
      });
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["video-480p", "bv*[height<=480]+ba/b[height<=480]"],
    ["video-720p", "bv*[height<=720]+ba/b[height<=720]"],
    ["video-1080p", "bv*[height<=1080]+ba/b[height<=1080]"],
    ["video-best", "bv*+ba/b"],
    ["audio", "ba"],
  ] as const)("requests %s without converting the source streams", async (preset, selector) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-preset-"));
    const tools = createMediaTools({ dataDirectory: directory });
    try {
      command.mockReturnValueOnce(Effect.succeed(JSON.stringify(metadata)));
      command.mockImplementationOnce((_file, args, options) =>
        Effect.promise(async () => {
          expect(args[args.indexOf("--format") + 1]).toBe(selector);
          expect(args).not.toContain("--extract-audio");
          expect(args).not.toContain("--audio-format");
          expect(args).not.toContain("--recode-video");
          const path = join(directory, "media.webm");
          await writeFile(path, "completed source stream");
          options.onLine?.(`MOVO_FILE:${JSON.stringify(path)}`);
          return "";
        }),
      );
      await Effect.runPromise(
        createMediaDownloader("yt-dlp", tools).download(url, directory, () => undefined, preset),
      );
      const args = command.mock.calls[1]?.[1] ?? [];
      expect(args.includes("--merge-output-format")).toBe(preset !== "audio");
      expect(args.includes("--ffmpeg-location")).toBe(preset !== "audio");
      expect(args.includes("res,fps,vcodec:h264,acodec:aac")).toBe(preset !== "audio");
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("gives actionable guidance when X blocks access without exposing cookie setup instructions", async () => {
    command.mockReturnValue(
      Effect.fail(
        new MediaError(
          "unavailable",
          "Account authentication is required. Use --cookies-from-browser.",
        ),
      ),
    );
    const downloader = createMediaDownloader(
      "yt-dlp",
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    await expect(Effect.runPromise(downloader.preview(xUrl))).rejects.toMatchObject({
      reason: "unavailable",
      message:
        "This X video is unavailable to Movo. Use a public post that opens without signing in, or try again later.",
    });
  });

  it("preserves an X format failure instead of presenting it as an access problem", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-x-format-"));
    const tools = createMediaTools({ dataDirectory: directory });
    try {
      command.mockReturnValueOnce(Effect.succeed(JSON.stringify(xMetadata)));
      command.mockReturnValueOnce(
        Effect.fail(new MediaError("unavailable", "The requested video quality is unavailable.")),
      );
      await expect(
        Effect.runPromise(
          createMediaDownloader("yt-dlp", tools).download(
            xUrl,
            directory,
            () => undefined,
            "video-480p",
          ),
        ),
      ).rejects.toMatchObject({
        message: "The requested video quality is unavailable.",
      });
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([url, xUrl])("explains how to configure missing yt-dlp for %s", async (input) => {
    const cause = Object.assign(new Error("Missing executable"), { code: "ENOENT" });
    command.mockReturnValue(
      Effect.fail(new MediaError("unavailable", "The executable is unavailable.", cause)),
    );
    const downloader = createMediaDownloader(
      "yt-dlp",
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    await expect(Effect.runPromise(downloader.preview(input))).rejects.toThrow("YTDLP_PATH");
  });
  it("allows unknown duration and passes a normalized URL as a single argument", async () => {
    command.mockReturnValue(Effect.succeed(JSON.stringify({ ...metadata, duration: null })));
    const downloader = createMediaDownloader(
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
    const downloader = createMediaDownloader(
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
        createMediaDownloader("yt-dlp", tools).download(url, directory, (update) =>
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
          options.onLine?.(
            `MOVO_PROGRESS:{"downloaded_bytes":${maxImportBytes - 1},"filename":"video"}`,
          );
          options.onLine?.('MOVO_PROGRESS:{"downloaded_bytes":2,"filename":"audio"}');
          return "";
        }),
      );
      await expect(
        Effect.runPromise(createMediaDownloader("yt-dlp", tools).download(url, directory, vi.fn())),
      ).rejects.toMatchObject({ reason: "tooLarge" });
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });
});
