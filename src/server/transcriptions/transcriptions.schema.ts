import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  transcriptionPhases,
  transcriptionStates,
  type Transcript,
  type TranscriptionDevice,
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
