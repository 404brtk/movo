import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { DownloadCollectionPage } from "../../../../src/shared/contracts/downloads.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maxImportBytes } from "../../../../src/shared/contracts/media.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { runCommand, streamCommand } from "../../../../src/server/process/command.ts";
import { createMediaDownloader } from "../../../../src/server/downloads/ytdlp.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createApp } from "../../../../src/server/http/app.ts";

vi.mock("../../../../src/server/process/command.ts", () => ({
  runCommand: vi.fn<typeof runCommand>(),
  streamCommand: vi.fn<typeof streamCommand>(),
}));
const command = vi.mocked(runCommand);
const stream = vi.mocked(streamCommand);
const ytdlp = () => Effect.succeed("yt-dlp");
const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const metadata = {
  id: "aaaaaaaaaaa",
  extractor_key: "Youtube",
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
const playlist = "https://www.youtube.com/playlist?list=PLabcdefghijk";
const collectionMetadata = {
  _type: "playlist",
  extractor_key: "YoutubeTab",
  id: "PLabcdefghijk",
  webpage_url: playlist,
  title: "A public playlist",
  availability: null,
};
const collectionVideo = {
  _type: "url",
  ie_key: "Youtube",
  id: metadata.id,
  url,
  title: metadata.title,
  duration: 2,
};
afterEach(() => vi.resetAllMocks());
const listedVideo = (entry: object, details = collectionMetadata) =>
  `MOVO_VIDEO:${JSON.stringify({
    ...entry,
    playlist_id: details.id,
    playlist_title: details.title,
    playlist_webpage_url: details.webpage_url,
    playlist_channel: "Channel - Videos",
    playlist_channel_id: details.id,
    playlist_uploader_id: "@Example",
  })}`;
const collectionEnd = (details: object = collectionMetadata) =>
  `MOVO_COLLECTION:${JSON.stringify(details)}`;

async function* stdout(...lines: string[]) {
  for (const line of lines) yield line;
}

describe("YouTube collection preview", () => {
  it("advances one traversal through large collections and replays the last cursor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-collection-http-"));
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: directory }));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const app = createApp(database, config, undefined, { downloader });
            yield* Effect.promise(async () => {
              const base = "http://127.0.0.1:4310/api/downloads";
              const preview = (body: unknown) =>
                app.request(`${base}/collection`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                });
              for (const body of [
                { url: playlist, cursor: -1 },
                { url: playlist, cursor: "1:500" },
                { url: `${url}&list=PLabcdefghijk` },
                { url: "https://www.youtube.com/playlist?list=RDMM" },
                { url: "https://www.youtube.com.evil.example/@example/videos" },
                { url: "x".repeat(2049) },
              ])
                expect((await preview(body)).status).toBe(400);
              expect((await preview({ url: "x".repeat(1_100_000) })).status).toBe(413);
              expect(
                (await preview({ url: playlist, cursor: "dbdb1846-5aa8-4416-a64b-71403e19ed53" }))
                  .status,
              ).toBe(409);
              expect(stream).not.toHaveBeenCalled();

              let read = 0;
              const videos = Array.from({ length: 5101 }, (_, index) => {
                const id = String(index).padStart(11, "0");
                return { ...collectionVideo, id, url: `https://www.youtube.com/watch?v=${id}` };
              });
              const traversal = async function* () {
                for (const entry of videos) {
                  read++;
                  yield listedVideo(entry);
                }
                yield collectionEnd();
              };
              stream.mockReturnValueOnce(Effect.succeed(traversal()));
              const readPage = async (cursor?: string) => {
                const response = await preview({ url: playlist, cursor });
                expect(response.status).toBe(200);
                return Schema.decodeUnknownSync(DownloadCollectionPage)(await response.json());
              };
              let page = await readPage();
              expect(page.title).toBe(collectionMetadata.title);
              expect(page.videos).toHaveLength(50);
              expect(read).toBe(51);
              let cursor = page.nextCursor;
              if (!cursor) throw new Error("Missing next cursor");
              const wrong = await preview({
                url: "https://www.youtube.com/@example/videos",
                cursor,
              });
              expect(wrong.status).toBe(409);
              const [second, retry] = await Promise.all([readPage(cursor), readPage(cursor)]);
              expect(retry).toEqual(second);
              expect(second.videos[0]?.url).toBe(videos[50]?.url);
              expect(read).toBe(101);
              page = second;
              for (let index = 2; index <= 102; index++) {
                cursor = page.nextCursor;
                if (!cursor) throw new Error("Missing next cursor");
                page = await readPage(cursor);
                expect(page.videos[0]?.url).toBe(videos[index * 50]?.url);
                expect(read).toBe(Math.min(5101, index * 50 + 51));
              }
              expect(await readPage(cursor)).toEqual(page);
              expect(page.nextCursor).toBeNull();
              expect(page.videos).toHaveLength(1);
              expect(stream).toHaveBeenCalledOnce();
              const args = stream.mock.calls[0]?.[1] ?? [];
              expect(args.slice(-2)).toEqual(["--", playlist]);
              expect(args).toEqual(
                expect.arrayContaining([
                  "--ignore-config",
                  "--no-cache-dir",
                  "--no-plugin-dirs",
                  "--no-remote-components",
                  "youtube:raise_incomplete_data",
                  "--flat-playlist",
                  "--lazy-playlist",
                  "--simulate",
                  "--print",
                ]),
              );
              expect(args[args.indexOf("--use-extractors") + 1]).toBe("youtube:tab");
              expect(args).not.toContain("--playlist-items");
              expect(command).not.toHaveBeenCalled();
              expect(await (await app.request(base)).json()).toEqual([]);
            });
          }),
        ),
      );
    } finally {
      await Effect.runPromise(downloader.closeCollections());
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("validates the collection identity and filters unavailable and non-video entries", async () => {
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
    const channel = "https://www.youtube.com/@example/videos";
    const details = {
      ...collectionMetadata,
      id: "UCabcdefghijklmnopqrstuv",
      webpage_url: channel,
      uploader_id: "@Example",
      title: "Channel - Videos - Videos",
      channel: "Channel - Videos",
    };
    const secondId = "bbbbbbbbbbb";
    const secondUrl = `https://www.youtube.com/watch?v=${secondId}`;
    const second = { ...collectionVideo, id: secondId, url: secondUrl };
    const entries = [
      collectionVideo,
      collectionVideo,
      { ...second, availability: "private" },
      { ...second, live_status: "is_upcoming" },
      { ...second, live_status: "post_live" },
      { ...second, is_live: true },
      { ...second, _type: "playlist" },
      { ...second, url: "https://other.example/video" },
      { ...second, url },
      { ...second, title: "[Deleted video]" },
      { ...second, url: `https://youtu.be/${secondId}`, title: null, duration: null },
    ];
    stream.mockReturnValueOnce(
      Effect.succeed(
        stdout(...entries.map((entry) => listedVideo(entry, details)), collectionEnd(details)),
      ),
    );
    expect(await Effect.runPromise(downloader.previewCollection({ url: channel }))).toEqual({
      title: details.channel,
      videos: [
        { url, title: metadata.title, durationSeconds: 2 },
        { url: secondUrl, title: `Video ${secondId}`, durationSeconds: null },
      ],
      nextCursor: null,
    });
    stream.mockReturnValueOnce(Effect.succeed(stdout(collectionEnd(details))));
    expect(await Effect.runPromise(downloader.previewCollection({ url: channel }))).toEqual({
      title: details.channel,
      videos: [],
      nextCursor: null,
    });
    for (const badLines of [
      [listedVideo(collectionVideo, details)],
      [listedVideo(collectionVideo)],
      [collectionEnd({ ...collectionMetadata, _type: "video" })],
      [collectionEnd({ ...collectionMetadata, extractor_key: "Generic" })],
      [collectionEnd({ ...collectionMetadata, id: "PLdifferentcollection" })],
      [collectionEnd(), collectionEnd()],
    ]) {
      stream.mockReturnValueOnce(Effect.succeed(stdout(...badLines)));
      await expect(
        Effect.runPromise(downloader.previewCollection({ url: playlist })),
      ).rejects.toMatchObject({
        reason: "unsupported",
      });
    }
  });

  it.each([
    ["This channel does not have a videos tab", "This YouTube channel has no Videos tab."],
    [
      "HTTP Error 404: Not Found",
      "YouTube could not find this playlist or channel. Check the link.",
    ],
    ["The required executable is unavailable.", "The required executable is unavailable."],
  ])("reports an actionable collection error for %s", async (detail, message) => {
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
    stream.mockReturnValueOnce(Effect.fail(new MediaError("unavailable", detail)));
    await expect(
      Effect.runPromise(downloader.previewCollection({ url: playlist })),
    ).rejects.toMatchObject({
      message,
    });
  });

  it("closes the active traversal on expiry and invalidates its cursor", async () => {
    vi.useFakeTimers();
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
    const release = vi.fn<() => void>();
    stream.mockReturnValueOnce(
      Effect.acquireRelease(
        Effect.succeed(stdout(...Array.from({ length: 51 }, () => listedVideo(collectionVideo)))),
        () => Effect.sync(release),
      ),
    );
    try {
      const { nextCursor } = await Effect.runPromise(
        downloader.previewCollection({ url: playlist }),
      );
      if (!nextCursor) throw new Error("Missing next cursor");
      expect(release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(release).toHaveBeenCalledOnce();
      await expect(
        Effect.runPromise(downloader.previewCollection({ url: playlist, cursor: nextCursor })),
      ).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(stream).toHaveBeenCalledOnce();
    } finally {
      await Effect.runPromise(downloader.closeCollections());
      vi.useRealTimers();
    }
  });

  it("times out a stalled page, closes the process and keeps the error actionable", async () => {
    vi.useFakeTimers();
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
    let resume: (() => void) | undefined;
    const stall = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const release = vi.fn<() => void>(() => resume?.());
    const traversal = async function* () {
      for (let index = 0; index < 51; index++) yield listedVideo(collectionVideo);
      await stall;
      yield collectionEnd();
    };
    stream.mockReturnValueOnce(
      Effect.acquireRelease(Effect.succeed(traversal()), () => Effect.sync(release)),
    );
    try {
      const { nextCursor } = await Effect.runPromise(
        downloader.previewCollection({ url: playlist }),
      );
      if (!nextCursor) throw new Error("Missing next cursor");
      const next = downloader.previewCollection({ url: playlist, cursor: nextCursor });
      await Promise.all([
        expect(Effect.runPromise(next)).rejects.toMatchObject({
          reason: "conflict",
          message: "YouTube took too long to send these videos.",
        }),
        vi.advanceTimersByTimeAsync(45000),
      ]);
      expect(release).toHaveBeenCalledOnce();
      await expect(Effect.runPromise(next)).rejects.toMatchObject({
        reason: "conflict",
        message: "This list has expired.",
      });
    } finally {
      await Effect.runPromise(downloader.closeCollections());
      vi.useRealTimers();
    }
  });
});

describe("Media downloader protocol", () => {
  it("previews an X post using its post identity rather than its media ID", async () => {
    command.mockReturnValue(Effect.succeed(JSON.stringify(xMetadata)));
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
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
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
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
        createMediaDownloader(ytdlp, tools).download(xUrl, directory, () => undefined, "audio"),
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
    [
      "video-480p",
      "bv*[height<=480][aspect_ratio>=?1]+ba/bv*[width<=480][aspect_ratio<1]+ba/bv*[height<=?480][width<=?480]+ba/b[height<=480][aspect_ratio>=?1]/b[width<=480][aspect_ratio<1]/b[height<=?480][width<=?480]",
    ],
    [
      "video-1080p",
      "bv*[height<=1080][aspect_ratio>=?1]+ba/bv*[width<=1080][aspect_ratio<1]+ba/bv*[height<=?1080][width<=?1080]+ba/b[height<=1080][aspect_ratio>=?1]/b[width<=1080][aspect_ratio<1]/b[height<=?1080][width<=?1080]",
    ],
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
        createMediaDownloader(ytdlp, tools).download(url, directory, () => undefined, preset),
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
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
    await expect(Effect.runPromise(downloader.preview(xUrl))).rejects.toMatchObject({
      reason: "unavailable",
      message:
        "This X link is unavailable to Movo. Use a public link that opens without signing in, or try again later.",
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
          createMediaDownloader(ytdlp, tools).download(
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

  it.each([url, xUrl])("reports unavailable yt-dlp for %s without running it", async (input) => {
    const unavailable = new MediaError(
      "unavailable",
      "yt-dlp is unavailable. Download yt-dlp in Movo or set YTDLP_PATH.",
    );
    const downloader = createMediaDownloader(
      () => Effect.fail(unavailable),
      createMediaTools({ dataDirectory: tmpdir() }),
    );
    await expect(Effect.runPromise(downloader.preview(input))).rejects.toThrow("YTDLP_PATH");
    expect(command).not.toHaveBeenCalled();
  });
  it("allows unknown duration and passes a normalized URL as a single argument", async () => {
    command.mockReturnValue(Effect.succeed(JSON.stringify({ ...metadata, duration: null })));
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
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
    const downloader = createMediaDownloader(ytdlp, createMediaTools({ dataDirectory: tmpdir() }));
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
          options.onLine?.("MOVO_SIZE:null");
          options.onLine?.("MOVO_SIZE:259.6");
          options.onLine?.('MOVO_PROGRESS:{"downloaded_bytes":100,"filename":"video"}');
          options.onLine?.('MOVO_PROGRESS:{"downloaded_bytes":30,"filename":"audio"}');
          options.onLine?.("MOVO_PROCESSING");
          await writeFile(path, "completed fixture");
          options.onLine?.(`MOVO_FILE:${JSON.stringify(path)}`);
          return "";
        }),
      );
      const result = await Effect.runPromise(
        createMediaDownloader(ytdlp, tools).download(url, directory, (update) =>
          updates.push(update),
        ),
      );
      expect(result.path).toBe(path);
      expect(updates).toContainEqual({ totalBytes: null });
      expect(updates).toContainEqual({ totalBytes: 260 });
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
        Effect.runPromise(createMediaDownloader(ytdlp, tools).download(url, directory, vi.fn())),
      ).rejects.toMatchObject({ reason: "tooLarge" });
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Site-specific yt-dlp profiles", () => {
  const combined1080 =
    "b[height<=1080][aspect_ratio>=?1]/b[width<=1080][aspect_ratio<1]/b[height<=?1080][width<=?1080]";
  const sites = [
    {
      link: "https://www.tiktok.com/@movo.test/video/123",
      extractor: "tiktok",
      result: { id: "123", extractor_key: "TikTok" },
      video: combined1080,
      audio: "b",
    },
    {
      link: "https://clips.twitch.tv/SomeClip-abc",
      extractor: "twitch:clips",
      result: { id: "987", display_id: "SomeClip-abc", extractor_key: "TwitchClips" },
      video: combined1080,
      audio: "ba/b",
    },
    {
      link: "https://www.instagram.com/reel/DfP5u9CFOTK/",
      extractor: "instagram",
      result: { id: "DfP5u9CFOTK", extractor_key: "Instagram" },
      video: `bv*[height<=1080][aspect_ratio>=?1]+ba/bv*[width<=1080][aspect_ratio<1]+ba/bv*[height<=?1080][width<=?1080]+ba/${combined1080}`,
      audio: "ba/b",
    },
    {
      link: "https://podcasts.apple.com/us/podcast/show/id1?i=2",
      extractor: "apple:podcasts",
      result: { id: "2", extractor_key: "ApplePodcasts" },
      video: "ba/b",
      audio: "ba/b",
    },
  ];

  it.each(sites)(
    "previews $link with the $extractor extractor and its own identity",
    async ({ link, extractor, result }) => {
      command.mockReturnValue(Effect.succeed(JSON.stringify({ ...metadata, ...result })));
      const downloader = createMediaDownloader(
        ytdlp,
        createMediaTools({ dataDirectory: tmpdir() }),
      );
      expect(await Effect.runPromise(downloader.preview(link))).toMatchObject({
        title: metadata.title,
      });
      const args = command.mock.calls[0]?.[1] ?? [];
      expect(args[args.indexOf("--use-extractors") + 1]).toBe(extractor);
    },
  );

  it.each(sites)(
    "rejects $extractor metadata from another extractor or item",
    async ({ link, result }) => {
      const downloader = createMediaDownloader(
        ytdlp,
        createMediaTools({ dataDirectory: tmpdir() }),
      );
      for (const invalid of [
        { ...metadata, ...result, extractor_key: "Generic" },
        { ...metadata, ...result, id: "other", display_id: "other" },
      ]) {
        command.mockReturnValueOnce(Effect.succeed(JSON.stringify(invalid)));
        await expect(Effect.runPromise(downloader.preview(link))).rejects.toMatchObject({
          reason: "unsupported",
        });
      }
    },
  );

  it.for(
    sites.flatMap((site) => [
      { ...site, preset: "video-1080p" as const, selector: site.video },
      { ...site, preset: "audio" as const, selector: site.audio },
    ]),
  )(
    "selects $selector for $extractor $preset downloads",
    async ({ link, extractor, result, preset, selector, audio }) => {
      const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-site-"));
      const tools = createMediaTools({ dataDirectory: directory });
      try {
        command.mockReturnValueOnce(Effect.succeed(JSON.stringify({ ...metadata, ...result })));
        command.mockImplementationOnce((_file, _args, options) =>
          Effect.promise(async () => {
            const path = join(directory, "media.m4a");
            await writeFile(path, "completed source stream");
            options.onLine?.(`MOVO_FILE:${JSON.stringify(path)}`);
            return "";
          }),
        );
        await Effect.runPromise(
          createMediaDownloader(ytdlp, tools).download(link, directory, () => undefined, preset),
        );
        const args = command.mock.calls[1]?.[1] ?? [];
        expect(args[args.indexOf("--format") + 1]).toBe(selector);
        expect(args.includes("--extract-audio")).toBe(selector === audio);
        expect(args.includes("--merge-output-format")).toBe(selector !== audio);
        expect(args.includes("m3u8:ffmpeg")).toBe(extractor === "apple:podcasts");
      } finally {
        await Effect.runPromise(tools.close());
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
