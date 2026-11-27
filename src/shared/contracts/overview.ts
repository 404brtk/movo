import { Schema } from "effect";
import { failureKinds } from "./ask.ts";

export const maxSummaryCharacters = 4000;
export const maxKeyPoints = 12;
export const maxKeyPointCharacters = 300;
export const maxChapterTitleCharacters = 120;
export const maxChapters = 200;
export const summarySources = ["model", "edited"] as const;
export const chaptersSources = ["site", "model", "manual"] as const;
export const overviewScopes = ["all", "summary", "chapters"] as const;

const Milliseconds = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const lineText = (maximum: number) =>
  Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maximum),
    Schema.isPattern(/\S/u),
    Schema.isPattern(/^[^\p{Cc}]+$/u),
  );

export const ChapterTitle = lineText(maxChapterTitleCharacters);
export const KeyPointText = lineText(maxKeyPointCharacters);
export const SummaryText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(maxSummaryCharacters),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^(?:[^\p{Cc}]|\n)+$/u),
);
export const ChapterId = Schema.String.check(Schema.isUUID(4));
export const OverviewScope = Schema.Literals(overviewScopes);
export type OverviewScope = typeof OverviewScope.Type;
export type ChaptersSource = (typeof chaptersSources)[number];

export const KeyPoint = Schema.Struct({ startMs: Milliseconds, text: KeyPointText });
export type KeyPoint = typeof KeyPoint.Type;
export const Chapter = Schema.Struct({ id: ChapterId, startMs: Milliseconds, title: ChapterTitle });
export type Chapter = typeof Chapter.Type;

export const RecordingSummary = Schema.Struct({
  text: SummaryText,
  keyPoints: Schema.Array(KeyPoint),
  source: Schema.Literals(summarySources),
  modelName: Schema.NullOr(Schema.String),
  updatedAt: Timestamp,
});
export type RecordingSummary = typeof RecordingSummary.Type;

export const RecordingOverview = Schema.Struct({
  summary: Schema.NullOr(RecordingSummary),
  stale: Schema.NullOr(Schema.Struct({ changes: Schema.NullOr(Milliseconds) })),
  chapters: Schema.Array(Chapter),
  chaptersSource: Schema.NullOr(Schema.Literals(chaptersSources)),
  writing: Schema.NullOr(
    Schema.Struct({
      scope: OverviewScope,
      part: Schema.NullOr(Milliseconds),
      parts: Schema.NullOr(Milliseconds),
    }),
  ),
  failure: Schema.NullOr(
    Schema.Struct({
      scope: OverviewScope,
      message: Schema.String,
      kind: Schema.Literals(failureKinds),
    }),
  ),
});
export type RecordingOverview = typeof RecordingOverview.Type;

export const OverviewWriteRequest = Schema.Struct({ scope: OverviewScope });
export const SummaryEdit = Schema.Struct({
  text: SummaryText,
  keyPoints: Schema.Array(KeyPoint).check(Schema.isMaxLength(maxKeyPoints)),
});
export type SummaryEdit = typeof SummaryEdit.Type;
export const ChapterCreate = Schema.Struct({
  id: Schema.optional(ChapterId),
  startMs: Milliseconds,
  title: ChapterTitle,
});
export type ChapterCreate = typeof ChapterCreate.Type;
export const ChapterUpdate = Schema.Struct({
  startMs: Schema.optional(Milliseconds),
  title: Schema.optional(ChapterTitle),
}).check(
  Schema.makeFilter(
    (update) =>
      update.startMs !== undefined || update.title !== undefined || "Change the time or title.",
  ),
);
export type ChapterUpdate = typeof ChapterUpdate.Type;
