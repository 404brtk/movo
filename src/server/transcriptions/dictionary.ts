import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Effect, Result, Schema, Semaphore } from "effect";
import {
  DictionaryEntry,
  maxDictionaryEntries,
  maxPreviewHits,
  type DictionaryDraft,
  type DictionaryPreview,
  type DictionaryPreviewRecording,
  type DictionaryPreviewRequest,
  type DictionarySave,
  type DictionarySaveResult,
} from "../../shared/contracts/dictionary.ts";
import { Transcript, type TranscriptWord } from "../../shared/contracts/transcriptions.ts";
import { dictionaryFixes, findDictionaryProblem } from "../../shared/transcript-dictionary.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError } from "../media/error.ts";
import { mediaItems } from "../media/media.schema.ts";
import { dictionaryEntries } from "./dictionary.schema.ts";
import { readDictionary } from "./dictionary-store.ts";
import type { Transcriptions } from "./jobs.ts";
import { transcriptionJobs } from "./transcriptions.schema.ts";

const contextWords = 6;
const textOf = (words: readonly TranscriptWord[]) => words.map((word) => word.text).join(" ");

const storage = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof MediaError
        ? cause
        : new MediaError(
            "storage",
            "Could not access the dictionary. Check the database and disk space.",
            cause,
          ),
  });

export function createDictionary(
  database: AppDatabase,
  transcriptions: Pick<Transcriptions, "fixDictionary" | "get">,
) {
  const saving = Semaphore.makeUnsafe(1);
  const entriesWith = (id: string | null, draft: DictionaryDraft) =>
    Effect.gen(function* () {
      const entries = yield* storage(() => readDictionary(database));
      const index = id === null ? -1 : entries.findIndex((entry) => entry.id === id);
      if (id !== null && index < 0)
        return yield* Effect.fail(
          new MediaError("notFound", "This dictionary entry no longer exists."),
        );
      const others = entries.filter((entry) => entry.id !== id);
      const problem = findDictionaryProblem(draft, others);
      if (problem) return yield* Effect.fail(new MediaError("invalid", problem.message));
      return { entries, index, others };
    });

  const preview = (request: DictionaryPreviewRequest) =>
    Effect.gen(function* () {
      const { others } = yield* entriesWith(request.id, request.draft);
      const entries = [...others, request.draft];
      const draftIndex = others.length;
      const rows = yield* storage(() =>
        database
          .select({
            mediaId: transcriptionJobs.mediaId,
            title: mediaItems.title,
            status: transcriptionJobs.status,
            revision: transcriptionJobs.revision,
            transcript: transcriptionJobs.transcript,
          })
          .from(transcriptionJobs)
          .innerJoin(mediaItems, eq(mediaItems.id, transcriptionJobs.mediaId))
          .all(),
      );
      let shown = 0;
      const recordings = yield* storage(() =>
        rows
          .flatMap((row): DictionaryPreviewRecording[] => {
            if (!row.transcript || ["queued", "running"].includes(row.status)) return [];
            const { words } = Schema.decodeUnknownSync(Transcript)(row.transcript);
            const fixes = dictionaryFixes(words, entries).filter((fix) => fix.entry === draftIndex);
            if (fixes.length === 0) return [];
            return [
              {
                mediaId: row.mediaId,
                title: row.title,
                revision: row.revision,
                hitCount: fixes.length,
                hits: fixes.map((fix) => {
                  const end = fix.firstWord + fix.wordCount;
                  return {
                    firstWord: fix.firstWord,
                    startMs: words[fix.firstWord]?.startMs ?? 0,
                    before: textOf(words.slice(fix.firstWord, end)),
                    after: fix.texts.join(" "),
                    leading: textOf(
                      words.slice(Math.max(0, fix.firstWord - contextWords), fix.firstWord),
                    ),
                    trailing: textOf(words.slice(end, end + contextWords)),
                    moreBefore: fix.firstWord > contextWords,
                    moreAfter: end + contextWords < words.length,
                    similar: fix.similar,
                  };
                }),
              },
            ];
          })
          .toSorted(
            (first, second) =>
              second.hitCount - first.hitCount || first.title.localeCompare(second.title),
          )
          .map((recording) => {
            const hits = recording.hits.slice(0, Math.max(0, maxPreviewHits - shown));
            shown += hits.length;
            return { ...recording, hits };
          }),
      );
      return {
        hitCount: recordings.reduce((total, recording) => total + recording.hitCount, 0),
        recordings,
      } satisfies DictionaryPreview;
    });

  const store = (id: string | null, draft: DictionaryDraft) =>
    Effect.gen(function* () {
      const { entries } = yield* entriesWith(id, draft);
      if (id === null && entries.length >= maxDictionaryEntries)
        return yield* Effect.fail(
          new MediaError(
            "invalid",
            `The dictionary can hold at most ${maxDictionaryEntries} entries. Remove one first.`,
          ),
        );
      const now = Date.now();
      const savedId = id ?? randomUUID();
      yield* storage(() => {
        if (id === null)
          database
            .insert(dictionaryEntries)
            .values({ id: savedId, ...draft, fixes: 0, createdAt: now, updatedAt: now })
            .run();
        else
          database
            .update(dictionaryEntries)
            .set({ ...draft, updatedAt: now })
            .where(eq(dictionaryEntries.id, id))
            .run();
      });
      return savedId;
    });

  const skipReason = (mediaId: string, failure: MediaError) =>
    Effect.gen(function* () {
      if (failure.reason === "notFound") return "It was deleted.";
      if (failure.reason !== "conflict") return failure.message;
      const job = yield* Effect.result(transcriptions.get(mediaId));
      return Result.isSuccess(job) && ["queued", "running"].includes(job.success?.status ?? "")
        ? "It's being transcribed again, and its new transcript will use the dictionary."
        : "It changed after the preview. Open the entry again to review it.";
    });

  const fix = (savedId: string, request: DictionarySave) =>
    Effect.gen(function* () {
      const entries = yield* storage(() => readDictionary(database));
      const index = entries.findIndex((entry) => entry.id === savedId);
      const titles = new Map(
        request.fix.length === 0
          ? []
          : yield* storage(() =>
              database
                .select({ id: mediaItems.id, title: mediaItems.title })
                .from(mediaItems)
                .where(
                  inArray(
                    mediaItems.id,
                    request.fix.map((recording) => recording.mediaId),
                  ),
                )
                .all()
                .map((item) => [item.id, item.title] as const),
            ),
      );
      let fixedWords = 0;
      let fixedRecordings = 0;
      const skipped: DictionarySaveResult["skipped"][number][] = [];
      for (const recording of request.fix) {
        const outcome = yield* Effect.result(
          transcriptions.fixDictionary(
            recording.mediaId,
            recording.revision,
            entries,
            index,
            new Set(recording.skip),
          ),
        );
        if (Result.isSuccess(outcome)) {
          fixedWords += outcome.success.fixed;
          if (outcome.success.fixed > 0) fixedRecordings++;
          continue;
        }
        skipped.push({
          mediaId: recording.mediaId,
          title: titles.get(recording.mediaId) ?? "A deleted recording",
          reason: yield* skipReason(recording.mediaId, outcome.failure),
        });
      }
      const entry = yield* storage(() =>
        Schema.decodeUnknownSync(DictionaryEntry)(
          database.select().from(dictionaryEntries).where(eq(dictionaryEntries.id, savedId)).get(),
        ),
      );
      return { entry, fixedWords, fixedRecordings, skipped } satisfies DictionarySaveResult;
    });

  return {
    list: () => storage(() => readDictionary(database)),
    preview,
    save: (id: string | null, request: DictionarySave) =>
      Effect.gen(function* () {
        const savedId = yield* store(id, request.draft);
        return yield* fix(savedId, request);
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(saving)),
    remove: (id: string) =>
      Effect.gen(function* () {
        const removed = yield* storage(() =>
          database.delete(dictionaryEntries).where(eq(dictionaryEntries.id, id)).run(),
        );
        if (removed.changes === 0)
          return yield* Effect.fail(
            new MediaError("notFound", "This dictionary entry no longer exists."),
          );
        return yield* storage(() => readDictionary(database));
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(saving)),
  };
}

export type Dictionary = ReturnType<typeof createDictionary>;
