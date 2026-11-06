import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mediaItems } from "./media.schema.ts";

export const searchIndex = sqliteTable("search_index", {
  version: integer("version").primaryKey({ autoIncrement: false }),
});

export const searchPassages = sqliteTable(
  "search_passages",
  {
    id: integer("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaItems.id),
    startMs: integer("start_ms").notNull(),
    text: text("text").notNull(),
    searchText: text("search_text").notNull(),
  },
  (table) => [index("search_passages_media_order").on(table.mediaId, table.startMs)],
);
