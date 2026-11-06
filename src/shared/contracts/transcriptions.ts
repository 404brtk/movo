import { Schema } from "effect";
import { MediaId } from "./media.ts";
import { ModelId } from "./models.ts";

export const transcriptionStates = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const transcriptionPhases = [
  "queued",
  "preparing",
  "loading",
  "transcribing",
  "finished",
] as const;
export type TranscriptionPhase = (typeof transcriptionPhases)[number];
const Milliseconds = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const TranscriptSegment = Schema.Struct({
  startMs: Milliseconds,
  endMs: Milliseconds,
  text: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(65536),
    Schema.isPattern(/\S/u),
  ),
}).check(
  Schema.makeFilter(
    (segment) => segment.endMs >= segment.startMs || "A passage ends before it starts.",
  ),
);
export const Transcript = Schema.Struct({
  language: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  segments: Schema.Array(TranscriptSegment).check(Schema.isMaxLength(200000)),
}).check(
  Schema.makeFilter(
    (transcript) =>
      transcript.segments.every(
        (segment, index) =>
          index === 0 || segment.startMs >= (transcript.segments[index - 1]?.startMs ?? 0),
      ) || "Passages are not in time order.",
  ),
);
export type Transcript = typeof Transcript.Type;
export const TranscriptionDevice = Schema.Struct({
  backend: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});
export type TranscriptionDevice = typeof TranscriptionDevice.Type;
export const transcriptExportFormats = ["txt", "srt", "vtt"] as const;
export const TranscriptExportFormat = Schema.Literals(transcriptExportFormats);
export type TranscriptExportFormat = typeof TranscriptExportFormat.Type;
export const TranscriptionJob = Schema.Struct({
  mediaId: MediaId,
  modelId: ModelId,
  status: Schema.Literals(transcriptionStates),
  phase: Schema.Literals(transcriptionPhases),
  transcript: Schema.NullOr(Transcript),
  device: Schema.NullOr(TranscriptionDevice),
  error: Schema.NullOr(Schema.String),
  cleanupError: Schema.NullOr(Schema.String),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  updatedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
}).check(
  Schema.makeFilter(
    (job) =>
      job.status !== "completed" ||
      job.transcript !== null ||
      "Completed transcriptions contain a transcript.",
  ),
);
export type TranscriptionJob = typeof TranscriptionJob.Type;
export const TranscriptionStatus = Schema.NullOr(TranscriptionJob);
