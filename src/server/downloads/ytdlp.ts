import { mkdir, readdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import {
  defaultDownloadPreset,
  DownloadPreview,
  getDownloadPreset,
  type DownloadPreset,
} from "../../shared/contracts/downloads.ts";
import { maxImportBytes } from "../../shared/contracts/media.ts";
import { MediaError } from "../media/error.ts";
import type { MediaTools } from "../media-tools/tools.ts";
import { runCommand } from "../process/command.ts";
import { youtubeUrl } from "./url.ts";

const Metadata = Schema.Struct({
  id: Schema.String,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  duration: Schema.optional(
    Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
  ),
  live_status: Schema.optional(Schema.String),
  _type: Schema.optional(Schema.String),
});
const Progress = Schema.Struct({
  downloaded_bytes: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  filename: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});
const baseArguments = [
  "--ignore-config",
  "--no-cache-dir",
  "--no-plugin-dirs",
  "--no-remote-components",
  "--no-js-runtimes",
  "--js-runtimes",
  `node:${process.execPath}`,
  "--no-playlist",
  "--socket-timeout",
  "20",
  "--retries",
  "2",
];

export function createYoutubeDownloader(ytdlpPath: string, tools: MediaTools) {
  const executable = /[/\\]/u.test(ytdlpPath) ? resolve(ytdlpPath) : ytdlpPath;
  const run = (args: string[], options: Parameters<typeof runCommand>[2]) =>
    runCommand(executable, args, options).pipe(
      Effect.mapError((error) => {
        const cause = error.cause;
        return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? new MediaError(
              "unavailable",
              "yt-dlp is unavailable. Install its official standalone executable and add it to PATH, or set YTDLP_PATH, then restart Movo.",
              error,
            )
          : error;
      }),
    );
  const inspect = (input: string) =>
    Effect.gen(function* () {
      const url = yield* Effect.try({
        try: () => youtubeUrl(input),
        catch: (cause) =>
          cause instanceof MediaError
            ? cause
            : new MediaError("invalid", "Invalid YouTube URL.", cause),
      });
      const raw = yield* run([...baseArguments, "--simulate", "--dump-single-json", "--", url], {
        timeoutMs: 45000,
      });
      const preview = yield* Effect.try({
        try: () => {
          const metadata = Schema.decodeUnknownSync(Metadata)(JSON.parse(raw));
          if (metadata["_type"] && metadata["_type"] !== "video")
            throw new MediaError(
              "unsupported",
              "Choose a single video, not a playlist or channel.",
            );
          if (metadata.live_status && !["not_live", "was_live"].includes(metadata.live_status))
            throw new MediaError(
              "unsupported",
              "Live and upcoming streams are not supported. Choose a completed video.",
            );
          if (!url.endsWith(`v=${metadata.id}`))
            throw new MediaError(
              "unsupported",
              "The source returned metadata for a different video.",
            );
          return Schema.decodeUnknownSync(DownloadPreview)({
            url,
            title: metadata.title,
            durationSeconds: metadata.duration ?? null,
          });
        },
        catch: (cause) =>
          cause instanceof MediaError
            ? cause
            : new MediaError(
                "unsupported",
                "Could not read this video's metadata. Try a public, completed YouTube video.",
                cause,
              ),
      });
      return { preview, raw };
    });

  return {
    preview: (url: string) => inspect(url).pipe(Effect.map((result) => result.preview)),
    download: (
      url: string,
      directory: string,
      update: (change: {
        title?: string;
        durationSeconds?: number | null;
        downloadedBytes?: number;
        phase?: "downloading" | "processing";
      }) => void,
      preset: DownloadPreset = defaultDownloadPreset,
    ) =>
      Effect.gen(function* () {
        const selected = getDownloadPreset(preset);
        const ffmpeg = selected.kind === "video" ? yield* tools.resolve("ffmpeg") : undefined;
        const ffprobe = yield* tools.resolve("ffprobe");
        const limit = selected.maxHeight === null ? "" : `[height<=${selected.maxHeight}]`;
        const { preview, raw } = yield* inspect(url);
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, "source.info.json"), raw, { flag: "wx" });
          },
          catch: (cause) =>
            new MediaError(
              "storage",
              "Could not create the download directory. Check disk space and permissions.",
              cause,
            ),
        });
        yield* Effect.try({
          try: () =>
            update({
              title: preview.title,
              durationSeconds: preview.durationSeconds,
              phase: "downloading",
            }),
          catch: (cause) => new MediaError("storage", "Could not update the download job.", cause),
        });
        const received = new Map<string, number>();
        let file: string | undefined;
        yield* run(
          [
            ...baseArguments,
            "--load-info-json",
            join(directory, "source.info.json"),
            "--no-simulate",
            "--format",
            selected.kind === "audio" ? "ba" : `bv*${limit}+ba/b${limit}`,
            ...(ffmpeg
              ? [
                  "--format-sort",
                  "res,fps,vcodec:h264,acodec:aac",
                  "--merge-output-format",
                  "mp4",
                  "--ffmpeg-location",
                  ffmpeg,
                ]
              : []),
            "--max-filesize",
            String(maxImportBytes),
            "--paths",
            directory,
            "--output",
            "media.%(ext)s",
            "--newline",
            "--progress",
            "--progress-delta",
            "0.5",
            "--progress-template",
            "download:MOVO_PROGRESS:%(progress)j",
            "--progress-template",
            "postprocess:MOVO_PROCESSING",
            "--print",
            "after_move:MOVO_FILE:%(filepath)j",
          ],
          {
            timeoutMs: 6 * 60 * 60 * 1000,
            cwd: directory,
            environment: {
              ...process.env,
              PATH: [
                ...(ffmpeg ? [dirname(ffmpeg)] : []),
                dirname(ffprobe),
                process.env.PATH ?? "",
              ].join(delimiter),
            },
            onLine: (line) => {
              if (line.startsWith("MOVO_PROGRESS:")) {
                const progress = Schema.decodeUnknownSync(Progress)(
                  JSON.parse(line.slice("MOVO_PROGRESS:".length)),
                );
                if (progress.downloaded_bytes !== undefined)
                  received.set(progress.filename ?? "media", progress.downloaded_bytes);
                const downloadedBytes = [...received.values()].reduce(
                  (sum, value) => sum + value,
                  0,
                );
                if (downloadedBytes > maxImportBytes)
                  throw new MediaError("tooLarge", "The download exceeds the 10 GiB limit.");
                update({ downloadedBytes: Math.floor(downloadedBytes), phase: "downloading" });
              } else if (line.startsWith("MOVO_PROCESSING")) update({ phase: "processing" });
              else if (line.startsWith("MOVO_FILE:"))
                file = Schema.decodeUnknownSync(Schema.String)(
                  JSON.parse(line.slice("MOVO_FILE:".length)),
                );
            },
          },
        );
        if (!file)
          return yield* Effect.fail(
            new MediaError(
              "unsupported",
              "The downloader did not produce a media file. The video may exceed the size limit or have no supported format.",
            ),
          );
        const output = file;
        const entries = yield* Effect.tryPromise({
          try: () => readdir(directory),
          catch: (cause) =>
            new MediaError("storage", "Could not inspect the download directory.", cause),
        });
        if (!entries.some((entry) => /^media\.[a-z0-9]+$/u.test(entry)))
          return yield* Effect.fail(
            new MediaError("unsupported", "The download has no completed media file."),
          );
        return { path: output, preview };
      }),
  };
}

export type YoutubeDownloader = ReturnType<typeof createYoutubeDownloader>;
