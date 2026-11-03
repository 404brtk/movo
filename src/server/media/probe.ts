import { execFile } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { MediaError } from "./error.ts";

const execute = promisify(execFile);
const ProbeResult = Schema.Struct({
  streams: Schema.Array(
    Schema.Struct({
      codec_type: Schema.String,
      disposition: Schema.optional(Schema.Struct({ attached_pic: Schema.Number })),
    }),
  ),
  format: Schema.Struct({ duration: Schema.String, format_name: Schema.String }),
});

export function probeMedia(path: string, originalName: string, executable: string) {
  return Effect.tryPromise({
    try: async (signal) => {
      const { stdout } = await execute(
        executable,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov,mp3,wav,ogg,flac,matroska,webm,aac",
          "-show_entries",
          "format=duration,format_name:stream=codec_type:stream_disposition=attached_pic",
          "-of",
          "json",
          path,
        ],
        { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, signal },
      );
      const probe = Schema.decodeUnknownSync(ProbeResult)(JSON.parse(stdout));
      const hasVideo = probe.streams.some(
        (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
      );
      const hasAudio = probe.streams.some((stream) => stream.codec_type === "audio");
      const durationSeconds = Number(probe.format.duration);
      if ((!hasVideo && !hasAudio) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new MediaError(
          "unsupported",
          "Choose a complete audio or video file with a readable duration.",
        );
      }
      const kind = hasVideo ? "video" : "audio";
      const formats = new Set(probe.format.format_name.split(","));
      let contentType: MediaItem["contentType"];
      if (formats.has("mov")) contentType = hasVideo ? "video/mp4" : "audio/mp4";
      else if (formats.has("matroska") || formats.has("webm")) {
        contentType =
          extname(originalName).toLowerCase() === ".webm"
            ? hasVideo
              ? "video/webm"
              : "audio/webm"
            : hasVideo
              ? "video/x-matroska"
              : "audio/x-matroska";
      } else if (formats.has("mp3")) contentType = "audio/mpeg";
      else if (formats.has("wav")) contentType = "audio/wav";
      else if (formats.has("ogg")) contentType = hasVideo ? "video/ogg" : "audio/ogg";
      else if (formats.has("flac")) contentType = "audio/flac";
      else if (formats.has("aac")) contentType = "audio/aac";
      else
        throw new MediaError(
          "unsupported",
          "This media container is not supported. Try MP4, WebM, MP3, M4A, WAV, Ogg or FLAC.",
        );
      return { kind, contentType, durationSeconds };
    },
    catch: (cause) => {
      if (cause instanceof MediaError) return cause;
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
        return new MediaError(
          "unavailable",
          "FFprobe is unavailable. Install FFmpeg and add it to PATH, or set FFPROBE_PATH, then try again.",
          cause,
        );
      }
      return new MediaError(
        "unsupported",
        "Could not read this media file. Try a supported, complete audio or video file.",
        cause,
      );
    },
  });
}
