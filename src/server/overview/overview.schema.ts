import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { failureKinds } from "../../shared/contracts/ask.ts";
import {
  chaptersSources,
  overviewScopes,
  summarySources,
  type KeyPoint,
} from "../../shared/contracts/overview.ts";
import { mediaItems } from "../media/media.schema.ts";

export const recordingOverviews = sqliteTable("recording_overviews", {
  mediaId: text("media_id")
    .primaryKey()
    .references(() => mediaItems.id),
  summary: text("summary"),
  keyPoints: text("key_points", { mode: "json" }).$type<KeyPoint[]>(),
  summarySource: text("summary_source", { enum: summarySources }),
  summaryModelName: text("summary_model_name"),
  summaryRevision: integer("summary_revision"),
  summaryResultRevision: integer("summary_result_revision"),
  summaryUpdatedAt: integer("summary_updated_at"),
  chaptersSource: text("chapters_source", { enum: chaptersSources }),
  writingScope: text("writing_scope", { enum: overviewScopes }),
  writingPart: integer("writing_part"),
  writingParts: integer("writing_parts"),
  writingError: text("writing_error"),
  writingErrorKind: text("writing_error_kind", { enum: failureKinds }),
  updatedAt: integer("updated_at").notNull(),
});

export const recordingChapters = sqliteTable(
  "recording_chapters",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaItems.id),
    startMs: integer("start_ms").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    unique("recording_chapters_start").on(table.mediaId, table.startMs),
    check("recording_chapters_start_positive", sql`${table.startMs} >= 0`),
  ],
);
