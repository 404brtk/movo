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
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Milliseconds = Count;
export const maxWordCharacters = 1024;
export const TranscriptWord = Schema.Struct({
  startMs: Milliseconds,
  endMs: Milliseconds,
  text: Schema.String.check(Schema.isMaxLength(maxWordCharacters), Schema.isPattern(/^\S+$/u)),
}).check(
  Schema.makeFilter((word) => word.endMs >= word.startMs || "A word ends before it starts."),
);
export type TranscriptWord = typeof TranscriptWord.Type;
export const WordReplacement = Schema.Struct({
  firstWord: Count,
  removed: Schema.Array(TranscriptWord),
  inserted: Schema.Array(TranscriptWord),
});
export type WordReplacement = typeof WordReplacement.Type;
export const TranscriptPatch = Schema.Array(WordReplacement);
export type TranscriptPatch = typeof TranscriptPatch.Type;
export const Transcript = Schema.Struct({
  language: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  words: Schema.Array(TranscriptWord).check(Schema.isMaxLength(1000000)),
}).check(
  Schema.makeFilter(
    (transcript) =>
      transcript.words.every(
        (word, index) => index === 0 || word.startMs >= (transcript.words[index - 1]?.startMs ?? 0),
      ) || "Words are not in time order.",
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
  revision: Count,
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

const Revision = Count;
const overlongWord = new RegExp(String.raw`\S{${maxWordCharacters + 1}}`, "u");
const wordText = (maxLength: number) =>
  Schema.String.check(
    Schema.isMaxLength(maxLength),
    Schema.makeFilter(
      (text) =>
        !overlongWord.test(text) || `Words can have at most ${maxWordCharacters} characters.`,
    ),
  );
export const maxEditCharacters = 10000;
export const maxReplaceCharacters = 512;
export const PassageEdit = Schema.Struct({
  revision: Revision,
  firstWord: Count,
  wordCount: Count.check(Schema.isGreaterThan(0)),
  text: wordText(maxEditCharacters),
});
export type PassageEdit = typeof PassageEdit.Type;
export const TranscriptReplace = Schema.Struct({
  revision: Revision,
  find: wordText(maxReplaceCharacters).check(
    Schema.makeFilter((text) => text.trim().length > 0 || "Enter the text to find."),
  ),
  replacement: wordText(maxReplaceCharacters),
});
export type TranscriptReplace = typeof TranscriptReplace.Type;
export const TranscriptRestore = Schema.Struct({ revision: Revision, target: Revision });
export type TranscriptRestore = typeof TranscriptRestore.Type;
export const transcriptChangeKinds = ["edit", "replace", "restore"] as const;
export const transcriptChangeSources = ["app", "mcp"] as const;
export type TranscriptChangeSource = (typeof transcriptChangeSources)[number];
const ChangeVersion = {
  revision: Revision.check(Schema.isGreaterThan(0)),
  source: Schema.Literals(transcriptChangeSources),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
};
export const TranscriptChange = Schema.Union([
  Schema.Struct({
    ...ChangeVersion,
    kind: Schema.Literals(["edit", "replace"]),
    replacementCount: Count,
    startMs: Schema.NullOr(Milliseconds),
    before: Schema.String,
    after: Schema.String,
  }),
  Schema.Struct({ ...ChangeVersion, kind: Schema.Literal("restore"), restoredRevision: Revision }),
]);
export type TranscriptChange = typeof TranscriptChange.Type;
export const defaultHistoryPage = 20;
export const maxHistoryPage = 100;
const QueryCount = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const TranscriptHistoryQuery = Schema.Struct({
  limit: Schema.optional(
    QueryCount.check(Schema.isBetween({ minimum: 1, maximum: maxHistoryPage })),
  ),
  offset: Schema.optional(QueryCount),
});
export const TranscriptHistory = Schema.Struct({
  changes: Schema.Array(TranscriptChange),
  total: Count,
});
export type TranscriptHistory = typeof TranscriptHistory.Type;
