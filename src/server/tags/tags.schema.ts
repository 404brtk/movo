import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tagColors } from "../../shared/contracts/tags.ts";
import { downloadJobs } from "../downloads/downloads.schema.ts";
import { mediaItems } from "../media/media.schema.ts";

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull().unique(),
    color: text("color", { enum: tagColors }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  () => [
    check(
      "tags_known_color",
      sql.raw(`"color" in (${tagColors.map((color) => `'${color}'`).join(", ")})`),
    ),
  ],
);

export const mediaTags = sqliteTable(
  "media_tags",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.mediaId, table.tagId] }),
    index("media_tags_by_tag").on(table.tagId),
  ],
);

export const downloadJobTags = sqliteTable(
  "download_job_tags",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => downloadJobs.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.tagId] }),
    index("download_job_tags_by_tag").on(table.tagId),
  ],
);
