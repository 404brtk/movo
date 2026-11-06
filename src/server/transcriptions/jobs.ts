import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result, Schema, Semaphore } from "effect";
import {
  Transcript,
  TranscriptionJob,
  type TranscriptionDevice,
  type TranscriptionPhase,
} from "../../shared/contracts/transcriptions.ts";
import { MediaId } from "../../shared/contracts/media.ts";
import type { AppDatabase } from "../db/database.ts";
import { createMediaLibrary } from "../media/library.ts";
import { MediaError } from "../media/error.ts";
import type { MediaTools } from "../media-tools/tools.ts";
import { queueTranscription } from "./queue.ts";
import { transcriptionJobs } from "./transcriptions.schema.ts";

export interface TranscriptionEngine {
  check: () => Effect.Effect<void, MediaError>;
  transcribe: (
    path: string,
    directory: string,
    update: (phase: TranscriptionPhase) => void,
    reportDevice: (device: TranscriptionDevice) => void,
  ) => Effect.Effect<Transcript, MediaError>;
}

const storage = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof MediaError
        ? cause
        : new MediaError(
            "storage",
            "Could not access transcriptions. Check the database and disk space.",
            cause,
          ),
  });

export function createTranscriptions(
  database: AppDatabase,
  config: { dataDirectory: string },
  tools: Pick<MediaTools, "resolve">,
  engine: TranscriptionEngine,
) {
  const library = createMediaLibrary(database, config.dataDirectory, () =>
    tools.resolve("ffprobe"),
  );
  const actions = Semaphore.makeUnsafe(1);
  let active: { mediaId: string; fiber: Fiber.Fiber<void, MediaError> } | undefined;
  let started = false;
  const row = (id: string) =>
    database.select().from(transcriptionJobs).where(eq(transcriptionJobs.mediaId, id)).get();
  const read = (id: string) =>
    storage(() => {
      const job = row(id);
      return job ? Schema.decodeUnknownSync(TranscriptionJob)(job) : null;
    });
  const updateRunning = (id: string, changes: Partial<typeof transcriptionJobs.$inferInsert>) =>
    database
      .update(transcriptionJobs)
      .set({ ...changes, updatedAt: Date.now() })
      .where(and(eq(transcriptionJobs.mediaId, id), eq(transcriptionJobs.status, "running")))
      .run();
  const interrupt = (id: string) =>
    updateRunning(id, {
      status: "interrupted",
      phase: "finished",
      error: "Movo stopped before transcription finished. Retry to start again.",
    });
  const cleanup = (id: string) =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        Effect.tryPromise({
          try: async () => {
            Schema.decodeUnknownSync(MediaId)(id);
            await rm(join(config.dataDirectory, "transcriptions", id), {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 100,
            });
          },
          catch: (cause) =>
            new MediaError(
              "storage",
              "Could not remove temporary transcription files. Close apps using them or check folder permissions, then retry or restart Movo.",
              cause,
            ),
        }),
      );
      yield* storage(() =>
        database
          .update(transcriptionJobs)
          .set({
            cleanupError: Result.isFailure(result) ? result.failure.message : null,
            updatedAt: Date.now(),
          })
          .where(eq(transcriptionJobs.mediaId, id))
          .run(),
      );
      return result;
    });
  const perform = (job: TranscriptionJob) =>
    Effect.gen(function* () {
      const outcome = yield* Effect.result(
        Effect.gen(function* () {
          if ((yield* read(job.mediaId))?.status !== "running") return;
          const cleaned = yield* cleanup(job.mediaId);
          if (Result.isFailure(cleaned)) yield* Effect.fail(cleaned.failure);
          const { path, item } = yield* library.file(job.mediaId);
          const directory = join(config.dataDirectory, "transcriptions", job.mediaId);
          yield* Effect.tryPromise({
            try: () => mkdir(directory, { recursive: true }),
            catch: (cause) =>
              new MediaError("storage", "Could not prepare transcription files.", cause),
          });
          const report = (changes: Partial<typeof transcriptionJobs.$inferInsert>) => {
            if (row(job.mediaId)?.status !== "running")
              throw new MediaError("invalid", "Transcription was cancelled.");
            updateRunning(job.mediaId, changes);
          };
          const result = yield* engine.transcribe(
            path,
            directory,
            (phase) => report({ phase }),
            (device) => report({ device }),
          );
          yield* storage(() => {
            const transcript = Schema.decodeUnknownSync(Transcript)(result);
            if (
              transcript.words.some(
                (word) => word.endMs > Math.ceil(item.durationSeconds * 1000) + 1000,
              )
            )
              throw new MediaError(
                "unsupported",
                "The engine returned words outside this recording.",
              );
            updateRunning(job.mediaId, {
              status: "completed",
              phase: "finished",
              transcript,
              error: null,
            });
          });
        }),
      );
      if (Result.isFailure(outcome))
        yield* storage(() =>
          updateRunning(job.mediaId, {
            status: "failed",
            phase: "finished",
            error: outcome.failure.message,
          }),
        );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* storage(() => interrupt(job.mediaId));
          yield* cleanup(job.mediaId);
        }).pipe(Effect.orDie),
      ),
    );

  const worker = Effect.forever(
    Effect.gen(function* () {
      const claimed = yield* storage(() =>
        database.transaction((transaction) => {
          const next = transaction
            .select()
            .from(transcriptionJobs)
            .where(eq(transcriptionJobs.status, "queued"))
            .orderBy(asc(transcriptionJobs.updatedAt), sql`rowid`)
            .get();
          if (!next) return undefined;
          return transaction
            .update(transcriptionJobs)
            .set({ status: "running", phase: "preparing", updatedAt: Date.now() })
            .where(
              and(
                eq(transcriptionJobs.mediaId, next.mediaId),
                eq(transcriptionJobs.status, "queued"),
              ),
            )
            .returning()
            .get();
        }),
      );
      if (!claimed) {
        yield* Effect.sleep("300 millis");
        return;
      }
      const job = yield* storage(() => Schema.decodeUnknownSync(TranscriptionJob)(claimed));
      const fiber = yield* Effect.forkChild(perform(job));
      active = { mediaId: job.mediaId, fiber };
      const exit = yield* Fiber.await(fiber);
      active = undefined;
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        yield* Effect.fail(
          new MediaError(
            "storage",
            "The transcription worker could not update its state.",
            exit.cause,
          ),
        );
    }),
  );
  const get = (id: string) =>
    Effect.gen(function* () {
      yield* library.get(id);
      return yield* read(id);
    });
  return {
    check: engine.check,
    get,
    removeMedia: (id: string) =>
      Effect.gen(function* () {
        const job = yield* get(id);
        if (job && !["queued", "running"].includes(job.status) && active?.mediaId === id)
          yield* Fiber.interrupt(active.fiber);
        return yield* library.remove(id);
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(actions)),
    enqueue: (id: string) =>
      Effect.gen(function* () {
        yield* library.file(id);
        const existing = yield* read(id);
        if (existing) return existing;
        yield* engine.check();
        return yield* storage(() => {
          queueTranscription(database, id);
          return Schema.decodeUnknownSync(TranscriptionJob)(row(id));
        });
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(actions)),
    cancel: (id: string) =>
      Effect.gen(function* () {
        const job = yield* get(id);
        if (!job || !["queued", "running"].includes(job.status)) return job;
        yield* storage(() =>
          database
            .update(transcriptionJobs)
            .set({ status: "cancelled", phase: "finished", error: null, updatedAt: Date.now() })
            .where(and(eq(transcriptionJobs.mediaId, id), eq(transcriptionJobs.status, job.status)))
            .run(),
        );
        if (active?.mediaId === id) yield* Fiber.interrupt(active.fiber);
        return yield* read(id);
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(actions)),
    retry: (id: string) =>
      Effect.gen(function* () {
        const job = yield* get(id);
        if (!job || ["queued", "running"].includes(job.status))
          return yield* Effect.fail(
            new MediaError("invalid", "Only finished transcriptions can be started again."),
          );
        if (active?.mediaId === id) yield* Fiber.interrupt(active.fiber);
        yield* library.file(id);
        yield* engine.check();
        const cleaned = yield* cleanup(id);
        if (Result.isFailure(cleaned)) return yield* Effect.fail(cleaned.failure);
        yield* storage(() =>
          database
            .update(transcriptionJobs)
            .set({
              status: "queued",
              phase: "queued",
              device: null,
              error: null,
              updatedAt: Date.now(),
            })
            .where(and(eq(transcriptionJobs.mediaId, id), eq(transcriptionJobs.status, job.status)))
            .run(),
        );
        return yield* read(id);
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(actions)),
    start: () =>
      Effect.gen(function* () {
        if (started)
          return yield* Effect.fail(
            new MediaError("invalid", "The transcription worker is already running."),
          );
        started = true;
        const terminal = yield* storage(() => {
          database
            .update(transcriptionJobs)
            .set({
              status: "interrupted",
              phase: "finished",
              error: "Movo stopped before transcription finished. Retry to start again.",
              updatedAt: Date.now(),
            })
            .where(eq(transcriptionJobs.status, "running"))
            .run();
          return database
            .select({ mediaId: transcriptionJobs.mediaId })
            .from(transcriptionJobs)
            .where(notInArray(transcriptionJobs.status, ["queued", "running"]))
            .all();
        });
        for (const job of terminal) yield* cleanup(job.mediaId);
        return yield* Effect.forkScoped(worker);
      }),
  };
}

export type Transcriptions = ReturnType<typeof createTranscriptions>;
