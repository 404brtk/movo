import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  transcriptChangeKinds,
  transcriptChangeSources,
  transcriptionPhases,
  transcriptionStates,
  type Transcript,
  type TranscriptionDevice,
  type TranscriptPatch,
} from "../../shared/contracts/transcriptions.ts";
import { mediaItems } from "../media/media.schema.ts";

export const transcriptionJobs = sqliteTable(
  "transcription_jobs",
  {
    mediaId: text("media_id")
      .primaryKey()
      .references(() => mediaItems.id),
    modelId: text("model_id").notNull(),
    status: text("status", { enum: transcriptionStates }).notNull(),
    phase: text("phase", { enum: transcriptionPhases }).notNull(),
    transcript: text("transcript", { mode: "json" }).$type<Transcript>(),
    device: text("device", { mode: "json" }).$type<TranscriptionDevice>(),
    error: text("error"),
    cleanupError: text("cleanup_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("transcription_queue_order").on(table.status, table.updatedAt)],
);

export const transcriptChanges = sqliteTable(
  "transcript_changes",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => transcriptionJobs.mediaId),
    revision: integer("revision").notNull(),
    kind: text("kind", { enum: transcriptChangeKinds }).notNull(),
    source: text("source", { enum: transcriptChangeSources }).notNull(),
    restoredRevision: integer("restored_revision"),
    patches: text("patches", { mode: "json" }).$type<TranscriptPatch[]>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.mediaId, table.revision] })],
);
