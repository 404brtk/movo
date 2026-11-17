import { Schema } from "effect";
import { MediaId } from "./media.ts";
import { maxWordCharacters } from "./transcriptions.ts";

export const maxTermCharacters = 100;
export const maxTermVariants = 50;
export const maxDictionaryEntries = 500;
export const maxPreviewHits = 200;

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));

export const DictionaryTerm = Schema.String.check(
  Schema.makeFilter((term) => term.trim().length > 0 || "Enter a word or phrase."),
  Schema.makeFilter((term) => term === term.trim() || "Remove spaces around the word."),
  Schema.isMaxLength(maxTermCharacters),
  Schema.makeFilter(
    (term) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(term) || "Keep the word or phrase on one line.",
  ),
  Schema.makeFilter(
    (term) =>
      term.split(/\s+/u).every((word) => word.length <= maxWordCharacters) ||
      `Words can have at most ${maxWordCharacters} characters.`,
  ),
);

export const DictionaryDraft = Schema.Struct({
  spelling: DictionaryTerm,
  similar: Schema.Boolean,
  alsoReplace: Schema.Array(DictionaryTerm).check(Schema.isMaxLength(maxTermVariants)),
  neverChange: Schema.Array(DictionaryTerm).check(Schema.isMaxLength(maxTermVariants)),
});
export type DictionaryDraft = typeof DictionaryDraft.Type;

export const DictionaryEntryId = Schema.String.check(Schema.isUUID());

export const DictionaryEntry = Schema.Struct({
  id: DictionaryEntryId,
  ...DictionaryDraft.fields,
  fixes: Count,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type DictionaryEntry = typeof DictionaryEntry.Type;
export const DictionaryList = Schema.Array(DictionaryEntry);

export const DictionaryPreviewRequest = Schema.Struct({
  id: Schema.NullOr(DictionaryEntryId),
  draft: DictionaryDraft,
});
export type DictionaryPreviewRequest = typeof DictionaryPreviewRequest.Type;

export const DictionaryHit = Schema.Struct({
  firstWord: Count,
  startMs: Count,
  before: Schema.String,
  after: Schema.String,
  leading: Schema.String,
  trailing: Schema.String,
  moreBefore: Schema.Boolean,
  moreAfter: Schema.Boolean,
  similar: Schema.Boolean,
});
export type DictionaryHit = typeof DictionaryHit.Type;

export const DictionaryPreviewRecording = Schema.Struct({
  mediaId: MediaId,
  title: Schema.String,
  revision: Count,
  hitCount: Count,
  hits: Schema.Array(DictionaryHit),
});
export type DictionaryPreviewRecording = typeof DictionaryPreviewRecording.Type;

export const DictionaryPreview = Schema.Struct({
  hitCount: Count,
  recordings: Schema.Array(DictionaryPreviewRecording),
});
export type DictionaryPreview = typeof DictionaryPreview.Type;

export const DictionaryFix = Schema.Struct({
  mediaId: MediaId,
  revision: Count,
  skip: Schema.Array(Count).check(Schema.isMaxLength(maxPreviewHits)),
});
export type DictionaryFix = typeof DictionaryFix.Type;

export const DictionarySave = Schema.Struct({
  draft: DictionaryDraft,
  fix: Schema.Array(DictionaryFix),
});
export type DictionarySave = typeof DictionarySave.Type;

export const DictionarySkipped = Schema.Struct({
  mediaId: MediaId,
  title: Schema.String,
  reason: Schema.String,
});

export const DictionarySaveResult = Schema.Struct({
  entry: DictionaryEntry,
  fixedWords: Count,
  fixedRecordings: Count,
  skipped: Schema.Array(DictionarySkipped),
});
export type DictionarySaveResult = typeof DictionarySaveResult.Type;
