import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ChaptersSource } from "../../shared/contracts/overview.ts";
import type { AppDatabase } from "../db/database.ts";
import { recordingChapters, recordingOverviews } from "./overview.schema.ts";

type OverviewDatabase = Pick<AppDatabase, "insert" | "update" | "delete" | "select">;

export function ensureOverview(database: OverviewDatabase, mediaId: string) {
  database
    .insert(recordingOverviews)
    .values({ mediaId, updatedAt: Date.now() })
    .onConflictDoNothing()
    .run();
}

export function updateOverview(
  database: OverviewDatabase,
  mediaId: string,
  changes: Partial<Omit<typeof recordingOverviews.$inferInsert, "mediaId">>,
) {
  ensureOverview(database, mediaId);
  database
    .update(recordingOverviews)
    .set({ ...changes, updatedAt: Date.now() })
    .where(eq(recordingOverviews.mediaId, mediaId))
    .run();
}

export function replaceChapters(
  database: OverviewDatabase,
  mediaId: string,
  chapters: readonly { startMs: number; title: string }[],
  source: ChaptersSource,
) {
  database.delete(recordingChapters).where(eq(recordingChapters.mediaId, mediaId)).run();
  const createdAt = Date.now();
  if (chapters.length > 0)
    database
      .insert(recordingChapters)
      .values(chapters.map((chapter) => ({ ...chapter, id: randomUUID(), mediaId, createdAt })))
      .run();
  updateOverview(database, mediaId, { chaptersSource: chapters.length > 0 ? source : null });
}

export function saveSiteChapters(
  database: OverviewDatabase,
  mediaId: string,
  chapters: readonly { startMs: number; title: string }[],
) {
  if (chapters.length > 0) replaceChapters(database, mediaId, chapters, "site");
}

export function removeOverview(database: OverviewDatabase, mediaId: string) {
  database.delete(recordingChapters).where(eq(recordingChapters.mediaId, mediaId)).run();
  database.delete(recordingOverviews).where(eq(recordingOverviews.mediaId, mediaId)).run();
}
