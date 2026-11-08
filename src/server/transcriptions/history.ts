import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { Schema } from "effect";
import {
  TranscriptChange,
  TranscriptPatch,
  type TranscriptHistory,
} from "../../shared/contracts/transcriptions.ts";
import { invertPatch } from "../../shared/transcript-edits.ts";
import type { AppDatabase } from "../db/database.ts";
import { transcriptChanges, transcriptionJobs } from "./transcriptions.schema.ts";

type HistoryDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

const decodePatch = Schema.decodeUnknownSync(TranscriptPatch);
const decodeChange = Schema.decodeUnknownSync(TranscriptChange);
const forMedia = (mediaId: string) => eq(transcriptChanges.mediaId, mediaId);

export function recordChange(
  database: HistoryDatabase,
  change: Omit<typeof transcriptChanges.$inferInsert, "createdAt">,
) {
  database
    .insert(transcriptChanges)
    .values({ ...change, createdAt: Date.now() })
    .run();
}

export function clearHistory(database: HistoryDatabase, mediaId: string) {
  database.delete(transcriptChanges).where(forMedia(mediaId)).run();
}

export function restartHistory(database: HistoryDatabase, mediaId: string) {
  clearHistory(database, mediaId);
  database
    .update(transcriptionJobs)
    .set({
      revision: sql`${transcriptionJobs.revision} + 1`,
      resultRevision: sql`${transcriptionJobs.revision} + 1`,
    })
    .where(eq(transcriptionJobs.mediaId, mediaId))
    .run();
}

export function patchesBackTo(database: HistoryDatabase, mediaId: string, revision: number) {
  return database
    .select({ patch: transcriptChanges.patch })
    .from(transcriptChanges)
    .where(and(forMedia(mediaId), gt(transcriptChanges.revision, revision)))
    .orderBy(desc(transcriptChanges.revision))
    .all()
    .map((change) => invertPatch(decodePatch(change.patch)));
}

const joinedText = (words: readonly { text: string }[] = []) =>
  words.map((word) => word.text).join(" ");

function summarize({
  revision,
  kind,
  source,
  restoredRevision,
  patch,
  createdAt,
}: typeof transcriptChanges.$inferSelect): TranscriptChange {
  const version = { revision, source, createdAt };
  if (kind === "restore") return decodeChange({ ...version, kind, restoredRevision });
  const replacements = decodePatch(patch);
  const [example] = replacements;
  return decodeChange({
    ...version,
    kind,
    replacementCount: replacements.length,
    startMs: (example?.removed[0] ?? example?.inserted[0])?.startMs ?? null,
    before: joinedText(example?.removed),
    after: joinedText(example?.inserted),
  });
}

export function listChanges(
  database: HistoryDatabase,
  mediaId: string,
  page: { limit: number; offset: number },
): TranscriptHistory {
  return {
    changes: database
      .select()
      .from(transcriptChanges)
      .where(forMedia(mediaId))
      .orderBy(desc(transcriptChanges.revision))
      .limit(page.limit)
      .offset(page.offset)
      .all()
      .map(summarize),
    total:
      database.select({ total: count() }).from(transcriptChanges).where(forMedia(mediaId)).get()
        ?.total ?? 0,
  };
}
