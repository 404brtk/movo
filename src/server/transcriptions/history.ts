import { and, count, desc, eq, gt, max } from "drizzle-orm";
import { Schema } from "effect";
import {
  TranscriptChange,
  TranscriptPatch,
  type TranscriptHistory,
} from "../../shared/contracts/transcriptions.ts";
import { invertPatch } from "../../shared/transcript-edits.ts";
import type { AppDatabase } from "../db/database.ts";
import { transcriptChanges } from "./transcriptions.schema.ts";

type HistoryDatabase = Pick<AppDatabase, "select" | "insert" | "delete">;

const decodePatches = Schema.decodeUnknownSync(Schema.Array(TranscriptPatch));
const decodeChange = Schema.decodeUnknownSync(TranscriptChange);
const forMedia = (mediaId: string) => eq(transcriptChanges.mediaId, mediaId);

export function transcriptRevision(database: HistoryDatabase, mediaId: string) {
  return (
    database
      .select({ revision: max(transcriptChanges.revision) })
      .from(transcriptChanges)
      .where(forMedia(mediaId))
      .get()?.revision ?? 0
  );
}

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

export function patchesBackTo(database: HistoryDatabase, mediaId: string, revision: number) {
  return database
    .select({ patches: transcriptChanges.patches })
    .from(transcriptChanges)
    .where(and(forMedia(mediaId), gt(transcriptChanges.revision, revision)))
    .orderBy(desc(transcriptChanges.revision))
    .all()
    .flatMap((change) => decodePatches(change.patches).toReversed().map(invertPatch));
}

const joinedText = (words: readonly { text: string }[] = []) =>
  words.map((word) => word.text).join(" ");

function summarize({
  revision,
  kind,
  source,
  restoredRevision,
  patches,
  createdAt,
}: typeof transcriptChanges.$inferSelect): TranscriptChange {
  const version = { revision, source, createdAt };
  if (kind === "restore") return decodeChange({ ...version, kind, restoredRevision });
  const replacements = decodePatches(patches).flat();
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
