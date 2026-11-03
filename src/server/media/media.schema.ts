import { sql } from "drizzle-orm";
import { check, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mediaContentTypes } from "../../shared/contracts/media.ts";

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    originalName: text("original_name").notNull(),
    kind: text("kind", { enum: ["audio", "video"] }).notNull(),
    contentType: text("content_type", { enum: mediaContentTypes }).notNull(),
    byteSize: integer("byte_size").notNull(),
    durationSeconds: real("duration_seconds").notNull(),
    importedAt: integer("imported_at").notNull(),
  },
  (table) => [
    check("media_positive_size", sql`${table.byteSize} > 0`),
    check("media_positive_duration", sql`${table.durationSeconds} > 0`),
  ],
);
