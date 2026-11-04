import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { downloadStates } from "../../shared/contracts/downloads.ts";
import { mediaItems } from "../media/media.schema.ts";

export const downloadJobs = sqliteTable(
  "download_jobs",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull().unique(),
    title: text("title"),
    durationSeconds: real("duration_seconds"),
    status: text("status", { enum: downloadStates }).notNull(),
    phase: text("phase", {
      enum: ["queued", "checking", "downloading", "processing", "saving", "finished"],
    }).notNull(),
    downloadedBytes: integer("downloaded_bytes").notNull().default(0),
    error: text("error"),
    mediaId: text("media_id").references(() => mediaItems.id),
    ownerPid: integer("owner_pid"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("download_queue_order").on(table.status, table.updatedAt),
    check("download_nonnegative_bytes", sql`${table.downloadedBytes} >= 0`),
  ],
);
