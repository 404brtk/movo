import { Schema } from "effect";

export const ModelId = Schema.Literals(["parakeet-ultra-q8", "sortformer-4spk-q8"]);
export type ModelId = typeof ModelId.Type;
export const ModelRole = Schema.Literals(["transcription", "speakers"]);
export type ModelRole = typeof ModelRole.Type;
export const activeModelPhases = ["checking", "downloading", "verifying"];
export const ModelInstallation = Schema.Struct({
  phase: Schema.Literals([
    "idle",
    "checking",
    "downloading",
    "verifying",
    "complete",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  downloadedBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.NullOr(Schema.String),
});
export type ModelInstallation = typeof ModelInstallation.Type;
export const ModelStatus = Schema.Struct({
  id: ModelId,
  role: ModelRole,
  name: Schema.String,
  description: Schema.String,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  sourceUrl: Schema.String,
  license: Schema.String,
  languages: Schema.Array(Schema.String),
  state: Schema.Literals(["missing", "ready", "broken"]),
  message: Schema.NullOr(Schema.String),
  installation: ModelInstallation,
});
export type ModelStatus = typeof ModelStatus.Type;
export const ModelList = Schema.Array(ModelStatus);
