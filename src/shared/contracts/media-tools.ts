import { Schema } from "effect";

const ToolSource = Schema.Literals(["configured", "managed", "system"]);
export const ToolAvailability = Schema.Union([
  Schema.Struct({ state: Schema.Literal("missing") }),
  Schema.Struct({
    state: Schema.Literal("ready"),
    source: ToolSource,
    version: Schema.String,
  }),
  Schema.Struct({
    state: Schema.Literal("broken"),
    source: ToolSource,
    message: Schema.String,
  }),
]);
export type ToolAvailability = typeof ToolAvailability.Type;

export const ToolDownload = Schema.Struct({
  provider: Schema.String,
  sourceUrl: Schema.String,
  version: Schema.String,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type ToolDownload = typeof ToolDownload.Type;

export const activeInstallationPhases = ["downloading", "verifying", "extracting", "validating"];

export const ToolInstallation = Schema.Struct({
  phase: Schema.Literals([
    "idle",
    "downloading",
    "verifying",
    "extracting",
    "validating",
    "complete",
    "failed",
  ]),
  downloadedBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.NullOr(Schema.String),
});
export type ToolInstallation = typeof ToolInstallation.Type;

export const MediaToolsStatus = Schema.Struct({
  ffprobe: ToolAvailability,
  ffmpeg: ToolAvailability,
  download: Schema.NullOr(ToolDownload),
  installation: ToolInstallation,
});
export type MediaToolsStatus = typeof MediaToolsStatus.Type;

export const YtdlpStatus = Schema.Struct({
  ytdlp: ToolAvailability,
  download: Schema.NullOr(ToolDownload),
  installation: ToolInstallation,
});
export type YtdlpStatus = typeof YtdlpStatus.Type;
