import { mkdir, readdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
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
import type { DownloadSite } from "../../shared/download-sources.ts";
import { downloadSource } from "./url.ts";

type SiteProfile = {
  label: string;
  extractor: string;
  extractorKey: string;
  identity: "id" | "display_id";
  video: "separate" | "combined" | null;
  audio: "ba" | "ba/b" | "b";
  downloadArguments?: readonly string[];
};

const profiles: Record<DownloadSite, SiteProfile> = {
  youtube: {
    label: "YouTube",
    extractor: "youtube",
    extractorKey: "Youtube",
    identity: "id",
    video: "separate",
    audio: "ba",
  },
  x: {
    label: "X",
    extractor: "twitter",
    extractorKey: "Twitter",
    identity: "display_id",
    video: "separate",
    audio: "ba/b",
  },
  tiktok: {
    label: "TikTok",
    extractor: "tiktok",
    extractorKey: "TikTok",
    identity: "id",
    video: "combined",
    audio: "b",
  },
  instagram: {
    label: "Instagram",
    extractor: "instagram",
    extractorKey: "Instagram",
    identity: "id",
    video: "separate",
    audio: "ba/b",
  },
  facebook: {
    label: "Facebook",
    extractor: "facebook",
    extractorKey: "Facebook",
    identity: "id",
    video: "separate",
    audio: "ba/b",
  },
  twitchVod: {
    label: "Twitch",
    extractor: "twitch:vod",
    extractorKey: "TwitchVod",
    identity: "id",
    video: "combined",
    audio: "ba/b",
  },
  twitchClip: {
    label: "Twitch",
    extractor: "twitch:clips",
    extractorKey: "TwitchClips",
    identity: "display_id",
    video: "combined",
    audio: "ba/b",
  },
  applePodcasts: {
    label: "Apple Podcasts",
    extractor: "apple:podcasts",
    extractorKey: "ApplePodcasts",
    identity: "id",
    video: null,
    audio: "ba/b",
    downloadArguments: ["--downloader", "m3u8:ffmpeg"],
  },
  googleDrive: {
    label: "Google Drive",
    extractor: "GoogleDrive",
    extractorKey: "GoogleDrive",
    identity: "id",
    video: "separate",
    audio: "ba/b",
  },
  dropbox: {
    label: "Dropbox",
    extractor: "dropbox",
    extractorKey: "Dropbox",
    identity: "id",
    video: "separate",
    audio: "ba/b",
  },
};

const videoFormat = (streams: "separate" | "combined", maxShortSide: number | null) => {
  const sizes =
    maxShortSide === null
      ? [""]
      : [
          `[height<=${maxShortSide}][aspect_ratio>=?1]`,
          `[width<=${maxShortSide}][aspect_ratio<1]`,
          `[height<=?${maxShortSide}][width<=?${maxShortSide}]`,
        ];
  return [
    ...(streams === "separate" ? sizes.map((size) => `bv*${size}+ba`) : []),
    ...sizes.map((size) => `b${size}`),
  ].join("/");
};

const Metadata = Schema.Struct({
  id: Schema.String,
  display_id: Schema.optional(Schema.String),
  extractor_key: Schema.optional(Schema.String),
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
const EstimatedSize = Schema.NullOr(
  Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
);
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

export function createMediaDownloader(
  resolveYtdlp: () => Effect.Effect<string, MediaError>,
  tools: MediaTools,
) {
  const run = (
    args: string[],
    options: Parameters<typeof runCommand>[2],
    unavailableMessage?: string,
  ) =>
    Effect.flatMap(resolveYtdlp(), (executable) =>
      runCommand(executable, args, options).pipe(
        Effect.mapError((error) =>
          unavailableMessage && error.reason === "unavailable"
            ? new MediaError("unavailable", unavailableMessage, error)
            : error,
        ),
      ),
    );
  const inspect = (input: string) =>
    Effect.gen(function* () {
      const source = yield* Effect.try({
        try: () => downloadSource(input),
        catch: (cause) =>
          cause instanceof MediaError
            ? cause
            : new MediaError("invalid", "Invalid download URL.", cause),
      });
      const { url } = source;
      const profile = profiles[source.site];
      const raw = yield* run(
        [
          ...baseArguments,
          "--use-extractors",
          profile.extractor,
          "--simulate",
          "--dump-single-json",
          "--",
          url,
        ],
        { timeoutMs: 45000 },
        source.site === "youtube"
          ? undefined
          : `This ${profile.label} link is unavailable to Movo. Use a public link that opens without signing in, or try again later.`,
      );
      const preview = yield* Effect.try({
        try: () => {
          const metadata = Schema.decodeUnknownSync(Metadata)(JSON.parse(raw));
          if (metadata["_type"] && metadata["_type"] !== "video")
            throw new MediaError(
              "unsupported",
              "Choose a single video. Posts with multiple videos, playlists and channels are not supported.",
            );
          if (metadata.live_status && !["not_live", "was_live"].includes(metadata.live_status))
            throw new MediaError(
              "unsupported",
              "Live and upcoming streams are not supported. Choose a completed video.",
            );
          if (metadata.extractor_key !== profile.extractorKey)
            throw new MediaError(
              "unsupported",
              `Choose a ${profile.label} link with one directly attached video or episode. External players and broadcasts are not supported.`,
            );
          if (metadata[profile.identity] !== source.id)
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
                "Could not read this link's metadata. Choose one public, completed video or podcast episode.",
                cause,
              ),
      });
      return { preview, raw, profile };
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
        totalBytes?: number | null;
        phase?: "downloading" | "processing";
      }) => void,
      preset: DownloadPreset = defaultDownloadPreset,
    ) =>
      Effect.gen(function* () {
        const selected = getDownloadPreset(preset);
        const { preview, raw, profile } = yield* inspect(url);
        const video =
          selected.kind === "video" && profile.video !== null
            ? videoFormat(profile.video, selected.maxHeight)
            : undefined;
        const extractAudio = !video && profile.audio !== "ba";
        const ffmpeg = video || extractAudio ? yield* tools.resolve("ffmpeg") : undefined;
        const ffprobe = yield* tools.resolve("ffprobe");
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
            video ?? profile.audio,
            ...(ffmpeg ? ["--ffmpeg-location", ffmpeg] : []),
            ...(profile.downloadArguments ?? []),
            ...(extractAudio ? ["--extract-audio", "--audio-format", "best"] : []),
            ...(video
              ? ["--format-sort", "res,fps,vcodec:h264,acodec:aac", "--merge-output-format", "mp4"]
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
            "video:MOVO_SIZE:%(filesize,filesize_approx|null)s",
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
              } else if (line.startsWith("MOVO_SIZE:")) {
                const size = Schema.decodeUnknownSync(EstimatedSize)(
                  JSON.parse(line.slice("MOVO_SIZE:".length)),
                );
                update({ totalBytes: size === null ? null : Math.round(size) });
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

export type MediaDownloader = ReturnType<typeof createMediaDownloader>;
