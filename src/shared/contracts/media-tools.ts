import { Schema } from "effect";

const ToolSource = Schema.Literals(["configured", "managed", "system"]);
const ToolAvailability = Schema.Union([
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

export const MediaToolsDownload = Schema.Struct({
  provider: Schema.String,
  sourceUrl: Schema.String,
  version: Schema.String,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type MediaToolsDownload = typeof MediaToolsDownload.Type;

export const activeInstallationPhases = ["downloading", "verifying", "extracting", "validating"];

export const MediaToolsStatus = Schema.Struct({
  ffprobe: ToolAvailability,
  ffmpeg: ToolAvailability,
  download: Schema.NullOr(MediaToolsDownload),
  installation: Schema.Struct({
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
  }),
});
export type MediaToolsStatus = typeof MediaToolsStatus.Type;
