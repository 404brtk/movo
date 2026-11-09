import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result, Schema, Semaphore } from "effect";
import {
  defaultDownloadPreset,
  DownloadJob,
  DownloadJobList,
  DownloadPreset,
  type DownloadRequest,
} from "../../shared/contracts/downloads.ts";
import { MediaId } from "../../shared/contracts/media.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError } from "../media/error.ts";
import { createMediaLibrary } from "../media/library.ts";
import { mediaItems } from "../media/media.schema.ts";
import type { MediaTools, MediaToolsConfig } from "../media-tools/tools.ts";
import type { YtdlpConfig } from "../media-tools/ytdlp.ts";
import { downloadJobs } from "./downloads.schema.ts";
import { downloadSource } from "./url.ts";
import type { MediaDownloader } from "./ytdlp.ts";
import { queueTranscription } from "../transcriptions/queue.ts";
import type { Transcriptions } from "../transcriptions/jobs.ts";

export type DownloadsConfig = MediaToolsConfig & YtdlpConfig;

const databaseOperation = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof MediaError
        ? cause
        : new MediaError(
            "storage",
            "Could not access download jobs. Check the database and disk space.",
            cause,
          ),
  });

const checkOptions = (preset: DownloadPreset, transcribe: boolean) => {
  if (!Schema.is(DownloadPreset)(preset))
    throw new MediaError("invalid", "Choose a supported download option.");
  if (!Schema.is(Schema.Boolean)(transcribe))
    throw new MediaError("invalid", "Choose whether to transcribe after downloading.");
};
const insertJob = (
  transaction: Pick<AppDatabase, "insert" | "update" | "select">,
  url: string,
  preset: DownloadPreset,
  transcribe: boolean,
  now: number,
) => {
  transaction
    .insert(downloadJobs)
    .values({
      id: randomUUID(),
      url,
      preset,
      transcribe,
      status: "queued",
      phase: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [downloadJobs.url, downloadJobs.preset] })
    .run();
  if (transcribe)
    transaction
      .update(downloadJobs)
      .set({ transcribe: true })
      .where(and(eq(downloadJobs.url, url), eq(downloadJobs.preset, preset)))
      .run();
  const job = Schema.decodeUnknownSync(DownloadJob)(
    transaction
      .select()
      .from(downloadJobs)
      .where(and(eq(downloadJobs.url, url), eq(downloadJobs.preset, preset)))
      .get(),
  );
  if (job.status === "completed" && job.transcribe && job.mediaId)
    queueTranscription(transaction, job.mediaId);
  return job;
};
const linkUrl = (input: string, index: number, count: number) => {
  try {
    return downloadSource(input).url;
  } catch (cause) {
    if (count === 1 || !(cause instanceof MediaError)) throw cause;
    throw new MediaError(cause.reason, `Link ${index + 1}: ${cause.message}`, cause);
  }
};

export function createDownloads(
  database: AppDatabase,
  config: DownloadsConfig,
  tools: MediaTools,
  downloader: MediaDownloader,
) {
  const retryLock = Semaphore.makeUnsafe(1);
  const library = createMediaLibrary(database, config.dataDirectory, () =>
    tools.resolve("ffprobe"),
  );
  let active: { id: string; fiber: Fiber.Fiber<void, MediaError> } | undefined;
  let started = false;
  const getRow = (id: string) => {
    if (!Schema.is(MediaId)(id)) throw new MediaError("notFound", "Download job not found.");
    const job = database.select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
    if (!job) throw new MediaError("notFound", "Download job not found.");
    return job;
  };
  const get = (id: string) =>
    databaseOperation(() => Schema.decodeUnknownSync(DownloadJob)(getRow(id)));
  const update = (id: string, changes: Partial<typeof downloadJobs.$inferInsert>) => {
    database
      .update(downloadJobs)
      .set({ ...changes, updatedAt: Date.now() })
      .where(and(eq(downloadJobs.id, id), eq(downloadJobs.status, "running")))
      .run();
  };
  const markCompleted = (id: string, media: typeof mediaItems.$inferSelect) =>
    database.transaction((transaction) => {
      const job = transaction.select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
      if (!job || job.status !== "running") return;
      transaction
        .update(downloadJobs)
        .set({
          status: "completed",
          phase: "finished",
          mediaId: media.id,
          title: media.title,
          durationSeconds: media.durationSeconds,
          downloadedBytes: media.byteSize,
          error: null,
          ownerPid: null,
          updatedAt: Date.now(),
        })
        .where(and(eq(downloadJobs.id, id), eq(downloadJobs.status, "running")))
        .run();
      if (job.transcribe) queueTranscription(transaction, media.id);
    });
  const markInterrupted = (id: string) =>
    update(id, {
      status: "interrupted",
      phase: "finished",
      ownerPid: null,
      error: "Movo stopped before this download finished. Retry to download it again.",
    });
  const cleanup = (id: string) =>
    Effect.tryPromise({
      try: async () => {
        Schema.decodeUnknownSync(MediaId)(id);
        await rm(join(config.dataDirectory, "downloads", id), {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      },
      catch: (cause) =>
        new MediaError(
          "storage",
          "Could not remove temporary download files. Close apps using them or check folder permissions, then retry or restart Movo.",
          cause,
        ),
    });
  const cleanupAndRecord = (id: string) =>
    Effect.gen(function* () {
      const result = yield* Effect.result(cleanup(id));
      yield* databaseOperation(() =>
        database
          .update(downloadJobs)
          .set({
            cleanupError: Result.isFailure(result) ? result.failure.message : null,
            updatedAt: Date.now(),
          })
          .where(eq(downloadJobs.id, id))
          .run(),
      );
      return result;
    });
  const perform = (job: DownloadJob) =>
    Effect.gen(function* () {
      const outcome = yield* Effect.result(
        Effect.gen(function* () {
          if ((yield* get(job.id)).status !== "running") return;
          yield* cleanup(job.id);
          const directory = join(config.dataDirectory, "downloads", job.id);
          yield* Effect.tryPromise({
            try: () => mkdir(directory, { recursive: true }),
            catch: (cause) =>
              new MediaError("storage", "Could not prepare the download directory.", cause),
          });
          const existing = yield* databaseOperation(() =>
            database.select().from(mediaItems).where(eq(mediaItems.id, job.id)).get(),
          );
          if (existing) {
            yield* databaseOperation(() => markCompleted(job.id, existing));
            return;
          }
          const result = yield* downloader.download(
            job.url,
            directory,
            (change) => {
              if (getRow(job.id).status !== "running")
                throw new MediaError("invalid", "The download was cancelled.");
              update(job.id, change);
            },
            job.preset,
          );
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* databaseOperation(() => {
                if (getRow(job.id).status !== "running")
                  throw new MediaError("invalid", "The download was cancelled.");
                update(job.id, { phase: "saving" });
              });
              const item = yield* library.adoptDownload(
                result.path,
                result.preview.title,
                result.preview.url,
                job.id,
              );
              yield* databaseOperation(() => markCompleted(job.id, item));
            }),
          );
        }),
      );
      if (Result.isFailure(outcome))
        yield* databaseOperation(() =>
          update(job.id, {
            status: "failed",
            phase: "finished",
            error: outcome.failure.message,
            ownerPid: null,
          }),
        );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* databaseOperation(() => markInterrupted(job.id));
          yield* cleanupAndRecord(job.id);
        }).pipe(Effect.orDie),
      ),
    );

  const worker = Effect.forever(
    Effect.gen(function* () {
      const claimed = yield* databaseOperation(() =>
        database.transaction((transaction) => {
          if (
            transaction
              .select({ id: downloadJobs.id })
              .from(downloadJobs)
              .where(eq(downloadJobs.status, "running"))
              .get()
          )
            return undefined;
          const next = transaction
            .select()
            .from(downloadJobs)
            .where(eq(downloadJobs.status, "queued"))
            .orderBy(asc(downloadJobs.updatedAt), sql`rowid`)
            .get();
          if (!next) return undefined;
          return transaction
            .update(downloadJobs)
            .set({
              status: "running",
              phase: "checking",
              ownerPid: process.pid,
              updatedAt: Date.now(),
            })
            .where(and(eq(downloadJobs.id, next.id), eq(downloadJobs.status, "queued")))
            .returning()
            .get();
        }),
      );
      if (!claimed) {
        yield* Effect.sleep("300 millis");
        return;
      }
      const job = yield* databaseOperation(() => Schema.decodeUnknownSync(DownloadJob)(claimed));
      const fiber = yield* Effect.forkChild(perform(job));
      active = { id: job.id, fiber };
      const exit = yield* Fiber.await(fiber);
      active = undefined;
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        yield* Effect.fail(
          new MediaError("storage", "The download worker could not update its state.", exit.cause),
        );
    }),
  );

  return {
    preview: downloader.preview,
    get,
    list: () =>
      databaseOperation(() =>
        Schema.decodeUnknownSync(DownloadJobList)(
          database
            .select()
            .from(downloadJobs)
            .orderBy(desc(downloadJobs.createdAt), desc(downloadJobs.id))
            .all(),
        ),
      ),
    enqueue: (input: string, preset: DownloadPreset = defaultDownloadPreset, transcribe = false) =>
      databaseOperation(() =>
        database.transaction((transaction) => {
          checkOptions(preset, transcribe);
          return insertJob(transaction, downloadSource(input).url, preset, transcribe, Date.now());
        }),
      ),
    enqueueAll: (
      inputs: readonly string[],
      preset: DownloadPreset = defaultDownloadPreset,
      transcribe = false,
    ) =>
      databaseOperation(() =>
        database.transaction((transaction) => {
          checkOptions(preset, transcribe);
          const urls = inputs.map((input, index) => linkUrl(input, index, inputs.length));
          const now = Date.now();
          return urls.map((url) => insertJob(transaction, url, preset, transcribe, now));
        }),
      ),
    cancel: (id: string) =>
      Effect.gen(function* () {
        const job = yield* get(id);
        if (!["queued", "running"].includes(job.status) || job.phase === "saving") return job;
        yield* databaseOperation(() =>
          database
            .update(downloadJobs)
            .set({
              status: "cancelled",
              phase: "finished",
              error: null,
              ownerPid: null,
              updatedAt: Date.now(),
            })
            .where(and(eq(downloadJobs.id, id), eq(downloadJobs.status, job.status)))
            .run(),
        );
        if (active?.id === id) yield* Fiber.interrupt(active.fiber);
        return yield* get(id);
      }),
    retry: (id: string) =>
      Effect.gen(function* () {
        const job = yield* get(id);
        if (!["failed", "cancelled", "interrupted"].includes(job.status))
          return yield* Effect.fail(
            new MediaError(
              "invalid",
              "Only failed, cancelled or interrupted downloads can be retried.",
            ),
          );
        if (active?.id === id) yield* Fiber.interrupt(active.fiber);
        const cleaned = yield* cleanupAndRecord(id);
        if (Result.isFailure(cleaned)) return yield* Effect.fail(cleaned.failure);
        yield* databaseOperation(() =>
          database
            .update(downloadJobs)
            .set({
              status: "queued",
              phase: "queued",
              downloadedBytes: 0,
              totalBytes: null,
              error: null,
              ownerPid: null,
              updatedAt: Date.now(),
            })
            .where(and(eq(downloadJobs.id, id), eq(downloadJobs.status, job.status)))
            .run(),
        );
        return yield* get(id);
      }).pipe(Effect.uninterruptible, Semaphore.withPermit(retryLock)),
    start: () =>
      Effect.gen(function* () {
        if (started)
          return yield* Effect.fail(
            new MediaError("invalid", "The download worker is already running."),
          );
        const recovered = yield* databaseOperation(() => {
          for (const job of database
            .select()
            .from(downloadJobs)
            .where(eq(downloadJobs.status, "running"))
            .all()) {
            const media = database.select().from(mediaItems).where(eq(mediaItems.id, job.id)).get();
            if (media) markCompleted(job.id, media);
            else markInterrupted(job.id);
          }
          return database
            .select({ id: downloadJobs.id })
            .from(downloadJobs)
            .where(notInArray(downloadJobs.status, ["running", "queued"]))
            .all();
        });
        for (const { id } of recovered) yield* cleanupAndRecord(id);
        started = true;
        return yield* Effect.forkScoped(worker);
      }),
  };
}

export type Downloads = ReturnType<typeof createDownloads>;

export const requestDownload = (
  downloads: Pick<Downloads, "enqueueAll">,
  transcriptions: Pick<Transcriptions, "check">,
  request: DownloadRequest,
) =>
  Effect.gen(function* () {
    if (request.transcribe) yield* transcriptions.check();
    return yield* downloads.enqueueAll(request.urls, request.preset, request.transcribe);
  });
