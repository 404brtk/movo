import { asc, eq, sql } from "drizzle-orm";
import { Schema } from "effect";
import { DictionaryList } from "../../shared/contracts/dictionary.ts";
import { Transcript } from "../../shared/contracts/transcriptions.ts";
import { dictionaryFixes } from "../../shared/transcript-dictionary.ts";
import { applyPatch, replaceRanges } from "../../shared/transcript-edits.ts";
import type { AppDatabase } from "../db/database.ts";
import { dictionaryEntries } from "./dictionary.schema.ts";
import { recordChange } from "./history.ts";
import { transcriptionJobs } from "./transcriptions.schema.ts";

type DictionaryDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

export const readDictionary = (database: Pick<AppDatabase, "select">) =>
  Schema.decodeUnknownSync(DictionaryList)(
    database
      .select()
      .from(dictionaryEntries)
      .orderBy(sql`${dictionaryEntries.spelling} collate nocase`, asc(dictionaryEntries.createdAt))
      .all(),
  );

export function addFixes(
  database: Pick<AppDatabase, "update">,
  entries: readonly { id: string }[],
  fixes: readonly { entry: number }[],
) {
  const counts = new Map<string, number>();
  for (const fix of fixes) {
    const entry = entries[fix.entry];
    if (!entry) throw new Error("A dictionary fix refers to a missing entry.");
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  for (const [id, count] of counts)
    database
      .update(dictionaryEntries)
      .set({ fixes: sql`${dictionaryEntries.fixes} + ${count}` })
      .where(eq(dictionaryEntries.id, id))
      .run();
}

export function applyDictionary(
  database: DictionaryDatabase,
  mediaId: string,
  transcript: Transcript,
) {
  const entries = readDictionary(database);
  const fixes = dictionaryFixes(transcript.words, entries);
  if (fixes.length === 0) return transcript;
  const job = database
    .select({ revision: transcriptionJobs.revision })
    .from(transcriptionJobs)
    .where(eq(transcriptionJobs.mediaId, mediaId))
    .get();
  if (!job) throw new Error("The transcription job disappeared while it was being completed.");
  const patch = replaceRanges(transcript.words, fixes);
  const fixed = Schema.decodeUnknownSync(Transcript)({
    ...transcript,
    words: applyPatch(transcript.words, patch),
  });
  const revision = job.revision + 1;
  database
    .update(transcriptionJobs)
    .set({ transcript: fixed, revision })
    .where(eq(transcriptionJobs.mediaId, mediaId))
    .run();
  recordChange(database, {
    mediaId,
    revision,
    kind: "dictionary",
    source: "app",
    restoredRevision: null,
    patch,
  });
  addFixes(database, entries, fixes);
  return fixed;
}
