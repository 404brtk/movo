import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { and, asc, count, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  RecordingOverview,
  type ChapterCreate,
  type ChapterUpdate,
  type OverviewScope,
  type SummaryEdit,
} from "../../shared/contracts/overview.ts";
import { formatMoment } from "../../shared/chapters.ts";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import type { AppDatabase } from "../db/database.ts";
import { aiConnections, askSettings } from "../ask/ask.schema.ts";
import {
  describeFailure,
  fallbackContextTokens,
  isContextOverflow,
  type AskBoundaries,
} from "../ask/ask.ts";
import { calibratedCharactersPerToken, trimThreshold } from "../ask/prompt.ts";
import { languageModel } from "../ask/providers.ts";
import { answerFromTranscriptParts } from "../ask/scan.ts";
import { transcriptContext } from "../ask/transcript-context.ts";
import { MediaError } from "../media/error.ts";
import type { createMediaLibrary } from "../media/library.ts";
import { mediaItems } from "../media/media.schema.ts";
import { setSearchSummary } from "../media/search.ts";
import { transcriptChanges, transcriptionJobs } from "../transcriptions/transcriptions.schema.ts";
import type { Transcriptions } from "../transcriptions/jobs.ts";
import { chapterTitle } from "./chapters.ts";
import {
  normalizeOverview,
  notesInstruction,
  notesPrompt,
  overviewInstructions,
  parseOverview,
  writesChapters,
  writesSummary,
} from "./model-output.ts";
import { recordingChapters, recordingOverviews } from "./overview.schema.ts";
import { ensureOverview, replaceChapters, updateOverview } from "./storage.ts";

export interface OverviewServices {
  library: Pick<ReturnType<typeof createMediaLibrary>, "get">;
  transcriptions: Pick<Transcriptions, "get">;
}

const interruptedMessage = "Movo stopped before the summary was finished. Try again.";
const writingConflict = "Wait for the summary to finish, or stop it.";

const storage = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof MediaError
        ? cause
        : new MediaError(
            "storage",
            "Could not save the summary or chapters. Check the database and disk space.",
            cause,
          ),
  });

const clearedWriting = {
  writingScope: null,
  writingPart: null,
  writingParts: null,
} as const;

type TranscriptVersion = Pick<TranscriptionJob, "revision" | "resultRevision">;

function staleness(
  row: typeof recordingOverviews.$inferSelect,
  job: TranscriptVersion | null,
  changesSince: (revision: number) => number,
) {
  if (row.summary === null || row.summaryRevision === null || !job) return null;
  if (row.summaryResultRevision !== job.resultRevision) return { changes: null };
  const changes = job.revision > row.summaryRevision ? changesSince(row.summaryRevision) : 0;
  return changes > 0 ? { changes } : null;
}

const overlaps = (writing: OverviewScope | null, part: "summary" | "chapters") =>
  writing !== null && (writing === "all" || writing === part);

const activeScope = (row: typeof recordingOverviews.$inferSelect | undefined) =>
  row && row.writingError === null ? row.writingScope : null;

function requireChapterStart(startMs: number, durationMs: number) {
  if (startMs >= durationMs) throw new MediaError("invalid", "Choose a time inside the recording.");
}

export function createOverviews(
  database: AppDatabase,
  services: OverviewServices,
  boundaries: Pick<AskBoundaries, "languageModel"> = { languageModel },
) {
  const live = new Map<string, { controller: AbortController; done: Promise<void> }>();

  const row = (mediaId: string) =>
    database.select().from(recordingOverviews).where(eq(recordingOverviews.mediaId, mediaId)).get();
  const chapters = (mediaId: string) =>
    database
      .select({
        id: recordingChapters.id,
        startMs: recordingChapters.startMs,
        title: recordingChapters.title,
      })
      .from(recordingChapters)
      .where(eq(recordingChapters.mediaId, mediaId))
      .orderBy(asc(recordingChapters.startMs))
      .all();
  const changesSince = (mediaId: string, revision: number) =>
    database
      .select({ total: count() })
      .from(transcriptChanges)
      .where(and(eq(transcriptChanges.mediaId, mediaId), gt(transcriptChanges.revision, revision)))
      .get()?.total ?? 0;

  const describe = (mediaId: string, job: TranscriptVersion | null) => {
    const stored = row(mediaId);
    return Schema.decodeUnknownSync(RecordingOverview)({
      summary:
        stored?.summary && stored.summarySource && stored.summaryUpdatedAt
          ? {
              text: stored.summary,
              keyPoints: stored.keyPoints ?? [],
              source: stored.summarySource,
              modelName: stored.summaryModelName,
              updatedAt: stored.summaryUpdatedAt,
            }
          : null,
      stale: stored ? staleness(stored, job, (revision) => changesSince(mediaId, revision)) : null,
      chapters: chapters(mediaId),
      chaptersSource: stored?.chaptersSource ?? null,
      writing:
        stored && activeScope(stored)
          ? { scope: stored.writingScope, part: stored.writingPart, parts: stored.writingParts }
          : null,
      failure:
        stored?.writingError && stored.writingErrorKind && stored.writingScope
          ? {
              scope: stored.writingScope,
              message: stored.writingError,
              kind: stored.writingErrorKind,
            }
          : null,
    });
  };

  const recording = (mediaId: string) =>
    Effect.all({
      item: services.library.get(mediaId),
      job: services.transcriptions.get(mediaId),
    });

  const overview = (mediaId: string) =>
    Effect.flatMap(services.library.get(mediaId), () =>
      storage(() => {
        const version = database
          .select({
            revision: transcriptionJobs.revision,
            resultRevision: transcriptionJobs.resultRevision,
          })
          .from(transcriptionJobs)
          .where(
            and(eq(transcriptionJobs.mediaId, mediaId), isNotNull(transcriptionJobs.transcript)),
          )
          .get();
        return describe(mediaId, version ?? null);
      }),
    );

  const change = (
    mediaId: string,
    part: "summary" | "chapters",
    apply: (context: { durationMs: number; job: TranscriptionJob | null }) => void,
  ) =>
    Effect.gen(function* () {
      const { item, job } = yield* recording(mediaId);
      return yield* storage(() => {
        database.transaction(() => {
          if (overlaps(activeScope(row(mediaId)), part))
            throw new MediaError("conflict", writingConflict);
          apply({ durationMs: item.durationSeconds * 1000, job });
        });
        return describe(mediaId, job);
      });
    });

  const requireFreeStart = (mediaId: string, startMs: number, exceptId?: string) => {
    const taken = database
      .select({ id: recordingChapters.id })
      .from(recordingChapters)
      .where(
        and(
          eq(recordingChapters.mediaId, mediaId),
          eq(recordingChapters.startMs, startMs),
          exceptId ? ne(recordingChapters.id, exceptId) : undefined,
        ),
      )
      .get();
    if (taken)
      throw new MediaError(
        "conflict",
        `Another chapter already starts at ${formatMoment(startMs)}.`,
      );
  };

  async function produce(mediaId: string, scope: OverviewScope, signal: AbortSignal) {
    const settings = database.select().from(askSettings).get();
    const connection = settings
      ? database
          .select()
          .from(aiConnections)
          .where(eq(aiConnections.id, settings.connectionId))
          .get()
      : undefined;
    if (!settings || !connection) {
      updateOverview(database, mediaId, {
        ...clearedWriting,
        writingScope: scope,
        writingError: "Connect a model in Settings to write a summary.",
        writingErrorKind: "model",
      });
      return;
    }
    try {
      const { item, job } = await Effect.runPromise(recording(mediaId), { signal });
      if (!job?.transcript?.words.length)
        throw new MediaError("invalid", "Transcribe this recording before writing a summary.");
      const context = transcriptContext(item.title, job.revision, job.transcript);
      const model = boundaries.languageModel(connection, settings.modelId);
      const read = async (instructions: string, prompt: string) =>
        (await generateText({ model, instructions, prompt, abortSignal: signal })).text;
      const instructions = overviewInstructions(scope);
      const budget = Math.floor(
        (settings.contextTokens ?? fallbackContextTokens[connection.kind]) *
          trimThreshold *
          calibratedCharactersPerToken(undefined),
      );
      let answer: string | undefined;
      if (instructions.length + context.text.length <= budget) {
        try {
          answer = await read(instructions, context.text);
        } catch (error) {
          if (!isContextOverflow(error)) throw error;
        }
      }
      if (answer === undefined) {
        answer = await answerFromTranscriptParts(
          {
            title: context.title,
            lines: context.lines,
            instruction: notesInstruction,
            callCharacters: budget,
            resultCharacters: budget - instructions.length - notesPrompt(context.title, "").length,
            read,
            tooLong: isContextOverflow,
            onProgress: (done, total) =>
              updateOverview(database, mediaId, {
                writingPart: Math.min(done + 1, total),
                writingParts: total,
              }),
          },
          (notes) => {
            updateOverview(database, mediaId, { writingPart: null, writingParts: null });
            return read(instructions, notesPrompt(context.title, notes));
          },
        );
      }
      const written = normalizeOverview(
        parseOverview(answer, scope),
        context.moments,
        item.durationSeconds * 1000,
      );
      signal.throwIfAborted();
      database.transaction((transaction) => {
        if (!transaction.select().from(mediaItems).where(eq(mediaItems.id, mediaId)).get()) return;
        if (writesSummary(scope) && written.summary) {
          updateOverview(transaction, mediaId, {
            summary: written.summary,
            keyPoints: written.keyPoints,
            summarySource: "model",
            summaryModelName: settings.modelName,
            summaryRevision: job.revision,
            summaryResultRevision: job.resultRevision,
            summaryUpdatedAt: Date.now(),
          });
          setSearchSummary(transaction, mediaId, {
            text: written.summary,
            keyPoints: written.keyPoints,
          });
        }
        if (writesChapters(scope)) replaceChapters(transaction, mediaId, written.chapters, "model");
        updateOverview(transaction, mediaId, {
          ...clearedWriting,
          writingError: null,
          writingErrorKind: null,
        });
      });
    } catch (error) {
      if (!row(mediaId)) return;
      if (signal.aborted) {
        updateOverview(database, mediaId, clearedWriting);
        return;
      }
      const failure =
        error instanceof MediaError
          ? { kind: "other" as const, message: error.message }
          : describeFailure(error, connection, settings.modelName);
      updateOverview(database, mediaId, {
        ...clearedWriting,
        writingScope: scope,
        writingError: failure.message,
        writingErrorKind: failure.kind,
      });
      console.error(error);
    }
  }

  return {
    recover: () =>
      storage(() => {
        database
          .update(recordingOverviews)
          .set({
            writingPart: null,
            writingParts: null,
            writingError: interruptedMessage,
            writingErrorKind: "other",
          })
          .where(
            and(
              isNotNull(recordingOverviews.writingScope),
              isNull(recordingOverviews.writingError),
            ),
          )
          .run();
      }),

    get: overview,

    write: (mediaId: string, scope: OverviewScope) =>
      Effect.gen(function* () {
        const { job } = yield* recording(mediaId);
        yield* storage(() => {
          if (!job?.transcript?.words.length)
            throw new MediaError("conflict", "Transcribe this recording before writing a summary.");
          if (!database.select().from(askSettings).get())
            throw new MediaError(
              "conflict",
              "Connect a model to write a summary, key points and chapters for this recording.",
            );
          if (live.has(mediaId) || activeScope(row(mediaId)))
            throw new MediaError("conflict", writingConflict);
          updateOverview(database, mediaId, {
            ...clearedWriting,
            writingScope: scope,
            writingError: null,
            writingErrorKind: null,
          });
        });
        const controller = new AbortController();
        const done = produce(mediaId, scope, controller.signal)
          .catch((error: unknown) => console.error(error))
          .finally(() => live.delete(mediaId));
        live.set(mediaId, { controller, done });
        return yield* storage(() => describe(mediaId, job));
      }),

    stop: (mediaId: string) =>
      Effect.gen(function* () {
        const current = live.get(mediaId);
        if (current) {
          current.controller.abort();
          yield* Effect.promise(() => current.done);
        }
        return yield* overview(mediaId);
      }),

    editSummary: (mediaId: string, edit: SummaryEdit) =>
      change(mediaId, "summary", ({ durationMs, job }) => {
        if (edit.keyPoints.some((point) => point.startMs >= durationMs))
          throw new MediaError("invalid", "Choose key point times inside the recording.");
        const keyPoints = edit.keyPoints
          .map((point) => ({ startMs: point.startMs, text: point.text.trim() }))
          .toSorted((first, second) => first.startMs - second.startMs);
        const text = edit.text.trim();
        updateOverview(database, mediaId, {
          summary: text,
          keyPoints,
          summarySource: "edited",
          summaryModelName: null,
          summaryRevision: job?.revision ?? null,
          summaryResultRevision: job?.resultRevision ?? null,
          summaryUpdatedAt: Date.now(),
        });
        setSearchSummary(database, mediaId, { text, keyPoints });
      }),

    deleteSummary: (mediaId: string) =>
      change(mediaId, "summary", () => {
        updateOverview(database, mediaId, {
          summary: null,
          keyPoints: null,
          summarySource: null,
          summaryModelName: null,
          summaryRevision: null,
          summaryResultRevision: null,
          summaryUpdatedAt: null,
        });
        setSearchSummary(database, mediaId, null);
      }),

    createChapter: (mediaId: string, chapter: ChapterCreate) =>
      change(mediaId, "chapters", ({ durationMs }) => {
        requireChapterStart(chapter.startMs, durationMs);
        requireFreeStart(mediaId, chapter.startMs);
        const id = chapter.id ?? randomUUID();
        if (database.select().from(recordingChapters).where(eq(recordingChapters.id, id)).get())
          throw new MediaError("conflict", "This chapter already exists.");
        ensureOverview(database, mediaId);
        database
          .insert(recordingChapters)
          .values({
            id,
            mediaId,
            startMs: chapter.startMs,
            title: chapterTitle(chapter.title),
            createdAt: Date.now(),
          })
          .run();
        if (!row(mediaId)?.chaptersSource)
          updateOverview(database, mediaId, { chaptersSource: "manual" });
      }),

    updateChapter: (mediaId: string, chapterId: string, update: ChapterUpdate) =>
      change(mediaId, "chapters", ({ durationMs }) => {
        const existing = database
          .select()
          .from(recordingChapters)
          .where(and(eq(recordingChapters.mediaId, mediaId), eq(recordingChapters.id, chapterId)))
          .get();
        if (!existing) throw new MediaError("notFound", "This chapter no longer exists.");
        if (update.startMs !== undefined) {
          requireChapterStart(update.startMs, durationMs);
          requireFreeStart(mediaId, update.startMs, chapterId);
        }
        database
          .update(recordingChapters)
          .set({
            startMs: update.startMs ?? existing.startMs,
            title: update.title === undefined ? existing.title : chapterTitle(update.title),
          })
          .where(eq(recordingChapters.id, chapterId))
          .run();
      }),

    deleteChapter: (mediaId: string, chapterId: string) =>
      change(mediaId, "chapters", () => {
        database
          .delete(recordingChapters)
          .where(and(eq(recordingChapters.mediaId, mediaId), eq(recordingChapters.id, chapterId)))
          .run();
        if (chapters(mediaId).length === 0)
          updateOverview(database, mediaId, { chaptersSource: null });
      }),

    deleteChapters: (mediaId: string) =>
      change(mediaId, "chapters", () => replaceChapters(database, mediaId, [], "manual")),

    close: () =>
      Effect.promise(async () => {
        for (const { controller } of live.values()) controller.abort();
        await Promise.all([...live.values()].map(({ done }) => done));
      }),
  };
}

export type Overviews = ReturnType<typeof createOverviews>;
