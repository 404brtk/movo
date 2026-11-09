import { Schema } from "effect";
import { searchTerms } from "../search-text.ts";
import { MediaItem, mediaKinds } from "./media.ts";

export const librarySorts = ["relevance", "newest", "oldest", "title"] as const;
export type LibrarySort = (typeof librarySorts)[number];
export const transcriptFilters = ["available", "missing"] as const;
export const libraryTranscriptions = ["none", "active", "stopped", "done"] as const;
export type LibraryTranscription = (typeof libraryTranscriptions)[number];
export const maxSearchLength = 200;

export const LibraryQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(maxSearchLength))),
  kind: Schema.optional(Schema.Literals(mediaKinds)),
  transcript: Schema.optional(Schema.Literals(transcriptFilters)),
  sort: Schema.optional(Schema.Literals(librarySorts)),
});
export type LibraryQuery = typeof LibraryQuery.Type;

export function librarySort({ q = "", sort }: LibraryQuery): LibrarySort {
  if (sort && sort !== "relevance") return sort;
  return searchTerms(q).length > 0 ? "relevance" : "newest";
}

const Offset = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const TextRange = Schema.Struct({ start: Offset, end: Offset }).check(
  Schema.makeFilter((range) => range.end > range.start || "A text range must not be empty."),
);
export type TextRange = typeof TextRange.Type;
const PassageMatch = Schema.Struct({
  startMs: Offset,
  text: Schema.String,
  ranges: Schema.Array(TextRange),
});
export const LibraryMatch = Schema.Struct({
  title: Schema.Array(TextRange),
  passages: Schema.Array(PassageMatch),
  passageCount: Offset,
});
export type LibraryMatch = typeof LibraryMatch.Type;
export const LibraryItem = Schema.Struct({
  ...MediaItem.fields,
  transcription: Schema.Literals(libraryTranscriptions),
  match: Schema.optionalKey(LibraryMatch),
});
export type LibraryItem = typeof LibraryItem.Type;
export const LibraryList = Schema.Struct({
  items: Schema.Array(LibraryItem),
  transcribing: Schema.Boolean,
});
export type LibraryList = typeof LibraryList.Type;
