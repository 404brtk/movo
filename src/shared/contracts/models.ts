import { Schema } from "effect";

export const SpeakerModelId = Schema.Literals(["sortformer-4spk-q8", "pyannote-wespeaker"]);
export type SpeakerModelId = typeof SpeakerModelId.Type;
export const ModelId = Schema.Literals(["parakeet-ultra-q8", ...SpeakerModelId.literals]);
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
  maxSpeakers: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  state: Schema.Literals(["missing", "ready", "broken"]),
  message: Schema.NullOr(Schema.String),
  installation: ModelInstallation,
});
export type ModelStatus = typeof ModelStatus.Type;
export const SpeakerLabels = Schema.Struct({ speakerModelId: Schema.NullOr(SpeakerModelId) });
export type SpeakerLabels = typeof SpeakerLabels.Type;
export const ModelCatalog = Schema.Struct({
  models: Schema.Array(ModelStatus),
  ...SpeakerLabels.fields,
});
export type ModelCatalog = typeof ModelCatalog.Type;
