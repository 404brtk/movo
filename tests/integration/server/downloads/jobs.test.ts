import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber, Result, type Scope } from "effect";
import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createDownloads, type Downloads } from "../../../../src/server/downloads/jobs.ts";
import { downloadJobs } from "../../../../src/server/downloads/downloads.schema.ts";
import type { MediaDownloader } from "../../../../src/server/downloads/ytdlp.ts";
import { blockCleanup } from "../../../helpers/block-cleanup.ts";

const firstUrl = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const secondUrl = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
const wavePath = new URL("../../../fixtures/tone.wav", import.meta.url);
const preview = (url: string) =>
  Effect.succeed({ url, title: "A controlled source recording", durationSeconds: 2 });
const fixtureDownload: MediaDownloader["download"] = (url, directory, update) =>
  Effect.gen(function* () {
    const path = join(directory, "media.wav");
    yield* Effect.promise(() => copyFile(wavePath, path));
    update({
      title: "A controlled source recording",
      durationSeconds: 2,
      downloadedBytes: 32078,
      phase: "downloading",
    });
    return { path, preview: yield* preview(url) };
  });

async function withJobs(
  signal: AbortSignal,
  test: (database: AppDatabase, directory: string) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-download-jobs-"));
  const running = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* openDatabase(join(directory, "app.sqlite"));
        yield* test(database, directory);
      }),
    ),
    { signal },
  );
  onTestFinished(async () => {
    await running.catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await running;
}

const waitFor = (jobs: Downloads, id: string, status: string) =>
  Effect.promise(async () => {
    await expect
      .poll(async () => (await Effect.runPromise(jobs.get(id))).status, { timeout: 10000 })
      .toBe(status);
  });

describe("persistent download jobs", () => {
  it("deduplicates X aliases and saves the normalized source URL in the library", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: fixtureDownload,
        });
        const job = yield* jobs.enqueue("https://twitter.com/example/status/123?s=20", "audio");
        const duplicate = yield* jobs.enqueue("https://x.com/another_name/status/123", "audio");
        expect(duplicate.id).toBe(job.id);
        expect(job.url).toBe("https://x.com/i/web/status/123");
        yield* jobs.cancel(job.id);
        expect((yield* jobs.retry(job.id)).url).toBe(job.url);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "completed");
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        const item = yield* library.get(job.id);
        expect(item.sourceUrl).toBe(job.url);
        expect(item.kind).toBe("audio");
        yield* Fiber.interrupt(worker);
        expect(yield* Effect.promise(() => readdir(join(directory, "downloads")))).toEqual([]);
      }),
    );
  });

  it("deduplicates each preset independently and retains it through cancellation and retry", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: fixtureDownload,
        });
        const standard = yield* jobs.enqueue(firstUrl);
        const smaller = yield* jobs.enqueue(firstUrl, "video-480p");
        const audio = yield* jobs.enqueue(firstUrl, "audio");
        expect(new Set([standard.id, smaller.id, audio.id]).size).toBe(3);
        expect((yield* jobs.enqueue("https://youtu.be/aaaaaaaaaaa?t=10", "audio")).id).toBe(
          audio.id,
        );
        expect((yield* jobs.enqueue(firstUrl, "video-480p")).id).toBe(smaller.id);
        expect(standard.preset).toBe("video-1080p");
        yield* jobs.cancel(audio.id);
        expect((yield* jobs.retry(audio.id)).preset).toBe("audio");
        const received: string[] = [];
        const restarted = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: (url, path, update, preset) => {
            received.push(preset ?? "missing");
            return fixtureDownload(url, path, update, preset);
          },
        });
        const worker = yield* restarted.start();
        yield* waitFor(restarted, audio.id, "completed");
        expect(received).toEqual(["video-1080p", "video-480p", "audio"]);
        expect((yield* restarted.get(smaller.id)).preset).toBe("video-480p");
        expect((yield* restarted.get(audio.id)).preset).toBe("audio");
        yield* Fiber.interrupt(worker);
      }),
    );
  });

  it("recovers a persisted running job even when its saved PID belongs to a live process", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: fixtureDownload,
        });
        const stale = yield* jobs.enqueue(firstUrl);
        database
          .update(downloadJobs)
          .set({ status: "running", ownerPid: process.pid })
          .where(eq(downloadJobs.id, stale.id))
          .run();
        const next = yield* jobs.enqueue(secondUrl);
        const worker = yield* jobs.start();
        expect((yield* jobs.get(stale.id)).status).toBe("interrupted");
        yield* waitFor(jobs, next.id, "completed");
        yield* Fiber.interrupt(worker);
      }),
    );
  });
  it.for(["failed", "completed", "cancelled"])(
    "isolates cleanup errors after a %s download and continues the queue",
    async (outcome, { signal }) => {
      await withJobs(signal, (database, directory) =>
        Effect.gen(function* () {
          let release: (() => Promise<void>) | undefined;
          let firstAttempt = true;
          const held = yield* Deferred.make<void>();
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.promise(async () => {
              await release?.();
            }),
          );
          const tools = createMediaTools({ dataDirectory: directory });
          const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
            preview,
            download: (url, staging, update) =>
              Effect.gen(function* () {
                if (url === firstUrl && firstAttempt) {
                  firstAttempt = false;
                  release = yield* Effect.promise(() => blockCleanup(staging));
                  yield* Deferred.succeed(held, undefined);
                  if (outcome === "cancelled") return yield* Effect.never;
                  if (outcome === "failed")
                    return yield* Effect.fail(
                      new MediaError("unavailable", "Controlled source failure."),
                    );
                }
                return yield* fixtureDownload(url, staging, update);
              }),
          });
          const first = yield* jobs.enqueue(firstUrl);
          const second = yield* jobs.enqueue(secondUrl);
          const worker = yield* jobs.start();
          if (outcome === "cancelled") {
            yield* Deferred.await(held);
            yield* jobs.cancel(first.id);
          }
          yield* waitFor(jobs, second.id, "completed");
          expect(yield* jobs.get(first.id)).toMatchObject({
            status: outcome,
            error: outcome === "failed" ? "Controlled source failure." : null,
            cleanupError: expect.stringContaining("temporary download files"),
          });
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          expect((yield* library.list()).length).toBe(outcome === "completed" ? 2 : 1);
          const retry = yield* Effect.result(jobs.retry(first.id));
          expect(retry).toMatchObject({ _tag: "Failure" });
          expect((yield* jobs.get(first.id)).status).toBe(outcome);
          if (!release) throw new Error("Cleanup fixture did not start.");
          yield* Effect.promise(release);
          release = undefined;
          if (outcome !== "completed") {
            yield* jobs.retry(first.id);
            yield* waitFor(jobs, first.id, "completed");
          }
          expect((yield* jobs.get(first.id)).status).toBe("completed");
          yield* Fiber.interrupt(worker);
        }),
      );
    },
  );
  it("claims a queued download, publishes a real media file and prevents duplicate URL jobs", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: fixtureDownload,
        });
        const job = yield* jobs.enqueue(firstUrl);
        expect((yield* jobs.enqueue("https://youtu.be/aaaaaaaaaaa")).id).toBe(job.id);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "completed");
        const completed = yield* jobs.get(job.id);
        expect(completed.mediaId).toBe(job.id);
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        const item = yield* library.get(job.id);
        expect(item.sourceUrl).toBe(firstUrl);
        expect(item.durationSeconds).toBe(2);
        const file = yield* library.file(job.id);
        expect(yield* Effect.promise(() => readFile(file.path))).toEqual(
          yield* Effect.promise(() => readFile(wavePath)),
        );
        yield* Fiber.interrupt(worker);
        expect(yield* Effect.promise(() => readdir(join(directory, "downloads")))).toEqual([]);
      }),
    );
  });

  it("starts with uncleared terminal jobs and clears their cleanup warning after recovery", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        let release: (() => Promise<void>) | undefined;
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.promise(async () => {
            await release?.();
          }),
        );
        const tools = createMediaTools({ dataDirectory: directory });
        const downloader = { preview, download: fixtureDownload };
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, downloader);
        const first = yield* jobs.enqueue(firstUrl);
        database
          .update(downloadJobs)
          .set({ status: "failed", phase: "finished", error: "Previous source failure." })
          .where(eq(downloadJobs.id, first.id))
          .run();
        yield* Effect.promise(() =>
          mkdir(join(directory, "downloads", first.id), { recursive: true }),
        );
        release = yield* Effect.promise(() => blockCleanup(join(directory, "downloads", first.id)));
        const second = yield* jobs.enqueue(secondUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, second.id, "completed");
        expect(yield* jobs.get(first.id)).toMatchObject({
          status: "failed",
          error: "Previous source failure.",
          cleanupError: expect.stringContaining("temporary download files"),
        });
        yield* Effect.promise(release);
        release = undefined;
        yield* Fiber.interrupt(worker);
        const restarted = createDownloads(
          database,
          { dataDirectory: directory },
          tools,
          downloader,
        );
        const nextWorker = yield* restarted.start();
        expect(yield* restarted.get(first.id)).toMatchObject({
          status: "failed",
          error: "Previous source failure.",
          cleanupError: null,
        });
        yield* Fiber.interrupt(nextWorker);
      }),
    );
  });

  it("queues a batch in the given order and puts a stopped link back in its place", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        let release: (() => Promise<void>) | undefined;
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.promise(async () => {
            await release?.();
          }),
        );
        const thirdUrl = "https://www.youtube.com/watch?v=ccccccccccc";
        const received: string[] = [];
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: (url, path, update, preset) => {
            received.push(url);
            return fixtureDownload(url, path, update, preset);
          },
        });
        const stopped = yield* jobs.enqueue(secondUrl);
        database
          .update(downloadJobs)
          .set({
            status: "failed",
            phase: "finished",
            error: "Previous source failure.",
            cleanupError: "Previous cleanup failure.",
          })
          .where(eq(downloadJobs.id, stopped.id))
          .run();
        const leftover = join(directory, "downloads", stopped.id);
        yield* Effect.promise(() => mkdir(leftover, { recursive: true }));
        release = yield* Effect.promise(() => blockCleanup(leftover));
        const batch = yield* jobs.enqueueAll([
          { url: firstUrl },
          { url: secondUrl },
          { url: thirdUrl },
        ]);
        expect(batch.map((job) => [job.url, job.status, job.error, job.cleanupError])).toEqual([
          [firstUrl, "queued", null, null],
          [secondUrl, "queued", null, null],
          [thirdUrl, "queued", null, null],
        ]);
        expect(batch[1]?.id).toBe(stopped.id);
        yield* Effect.promise(release);
        release = undefined;
        const worker = yield* jobs.start();
        yield* waitFor(jobs, batch[2]?.id ?? "", "completed");
        expect(received).toEqual([firstUrl, secondUrl, thirdUrl]);
        yield* Fiber.interrupt(worker);
      }),
    );
  });

  it("runs one download at a time, cancels its process work and continues with the next job", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        let active = 0;
        let maximum = 0;
        let cleaned = false;
        const tools = createMediaTools({ dataDirectory: directory });
        const download: MediaDownloader["download"] = (url, path, update) =>
          Effect.gen(function* () {
            active++;
            maximum = Math.max(maximum, active);
            if (url === firstUrl) yield* Deferred.await(gate);
            return yield* fixtureDownload(url, path, update);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active--;
                cleaned = true;
              }),
            ),
          );
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download,
        });
        const first = yield* jobs.enqueue(firstUrl);
        const second = yield* jobs.enqueue(secondUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, first.id, "running");
        expect((yield* jobs.get(second.id)).status).toBe("queued");
        yield* jobs.cancel(first.id);
        expect(cleaned).toBe(true);
        expect((yield* jobs.get(first.id)).status).toBe("cancelled");
        yield* waitFor(jobs, second.id, "completed");
        expect(maximum).toBe(1);
        yield* Fiber.interrupt(worker);
        expect(yield* Effect.promise(() => readdir(join(directory, "downloads")))).toEqual([]);
      }),
    );
  });

  it("keeps a re-added link in its place while its cancelled attempt is still finishing", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) => {
      const finishing = Deferred.makeUnsafe<void>();
      return Effect.gen(function* () {
        const received: string[] = [];
        let attempts = 0;
        const tools = createMediaTools({ dataDirectory: directory });
        const download: MediaDownloader["download"] = (url, path, update, preset) => {
          received.push(url);
          return url === firstUrl && ++attempts === 1
            ? Effect.never.pipe(Effect.ensuring(Deferred.await(finishing)))
            : fixtureDownload(url, path, update, preset);
        };
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download,
        });
        const first = yield* jobs.enqueue(firstUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, first.id, "running");
        const cancelling = yield* Effect.forkChild(jobs.cancel(first.id));
        yield* waitFor(jobs, first.id, "cancelled");
        const batch = yield* jobs.enqueueAll([{ url: firstUrl }, { url: secondUrl }]);
        expect(batch.map((job) => job.status)).toEqual(["queued", "queued"]);
        yield* Effect.sleep("20 millis");
        yield* Deferred.succeed(finishing, undefined);
        yield* Fiber.join(cancelling);
        yield* waitFor(jobs, batch[1]?.id ?? "", "completed");
        expect(received).toEqual([firstUrl, firstUrl, secondUrl]);
        expect((yield* jobs.get(first.id)).cleanupError).toBe(null);
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.ensuring(Deferred.succeed(finishing, undefined)));
    });
  });

  it("waits for a running retry before re-adding its link", async ({ signal }) => {
    await withJobs(signal, (database, directory) => {
      const finishing = Deferred.makeUnsafe<void>();
      return Effect.gen(function* () {
        const received: string[] = [];
        const tools = createMediaTools({ dataDirectory: directory });
        const download: MediaDownloader["download"] = (url, path, update, preset) => {
          received.push(url);
          return received.length === 1
            ? Effect.never.pipe(Effect.ensuring(Deferred.await(finishing)))
            : fixtureDownload(url, path, update, preset);
        };
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download,
        });
        const job = yield* jobs.enqueue(firstUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "running");
        const cancelling = yield* Effect.forkChild(jobs.cancel(job.id));
        yield* waitFor(jobs, job.id, "cancelled");
        const retrying = yield* Effect.forkChild(jobs.retry(job.id));
        yield* Effect.sleep("20 millis");
        const adding = yield* Effect.forkChild(jobs.enqueueAll([{ url: firstUrl }]));
        yield* Effect.sleep("20 millis");
        expect((yield* jobs.get(job.id)).status).toBe("cancelled");
        yield* Deferred.succeed(finishing, undefined);
        yield* Fiber.join(cancelling);
        expect((yield* Fiber.join(retrying)).id).toBe(job.id);
        expect((yield* Fiber.join(adding)).map((item) => item.id)).toEqual([job.id]);
        yield* waitFor(jobs, job.id, "completed");
        expect(received).toEqual([firstUrl, firstUrl]);
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.ensuring(Deferred.succeed(finishing, undefined)));
    });
  });

  it("retries a failed job without losing its identity or publishing partial media", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        let attempts = 0;
        const tools = createMediaTools({ dataDirectory: directory });
        const download: MediaDownloader["download"] = (url, path, update) =>
          ++attempts === 1
            ? Effect.gen(function* () {
                yield* Effect.promise(() =>
                  writeFile(join(path, "media.mp4.part"), "unfinished download"),
                );
                return yield* Effect.fail(
                  new MediaError("unavailable", "The source is temporarily unavailable."),
                );
              })
            : fixtureDownload(url, path, update);
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download,
        });
        const job = yield* jobs.enqueue(firstUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "failed");
        expect((yield* jobs.get(job.id)).error).toBe("The source is temporarily unavailable.");
        yield* Effect.promise(async () => {
          await expect.poll(() => readdir(join(directory, "downloads"))).toEqual([]);
        });
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        expect(yield* library.list()).toEqual([]);
        expect(
          yield* Effect.promise(() => stat(join(directory, "media")).catch(() => null)),
        ).toBeNull();
        expect((yield* jobs.retry(job.id)).id).toBe(job.id);
        yield* waitFor(jobs, job.id, "completed");
        expect(attempts).toBe(2);
        expect((yield* jobs.list()).length).toBe(1);
        expect((yield* library.list()).length).toBe(1);
        yield* Fiber.interrupt(worker);
      }),
    );
  });

  it("accepts only one concurrent retry and saves the retried media intact", async ({ signal }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: fixtureDownload,
        });
        const job = yield* jobs.enqueue(firstUrl);
        yield* jobs.cancel(job.id);
        const staging = join(directory, "downloads", job.id);
        yield* Effect.promise(async () => {
          await mkdir(staging, { recursive: true });
          await writeFile(join(staging, "media.wav.part"), "previous download bytes");
        });
        const retries = yield* Effect.all(
          [Effect.result(jobs.retry(job.id)), Effect.result(jobs.retry(job.id))],
          { concurrency: "unbounded" },
        );
        expect(retries.filter(Result.isSuccess)).toHaveLength(1);
        expect(retries.filter(Result.isFailure)).toMatchObject([
          { failure: { reason: "invalid" } },
        ]);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "completed");
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        const file = yield* library.file(job.id);
        expect(yield* Effect.promise(() => readFile(file.path))).toEqual(
          yield* Effect.promise(() => readFile(wavePath)),
        );
        yield* Fiber.interrupt(worker);
      }),
    );
  });

  it("marks running work interrupted on shutdown while preserving queued work", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: () => Effect.never,
        });
        const first = yield* jobs.enqueue(firstUrl);
        const second = yield* jobs.enqueue(secondUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, first.id, "running");
        yield* Fiber.interrupt(worker);
        expect((yield* jobs.get(first.id)).status).toBe("interrupted");
        expect((yield* jobs.get(second.id)).status).toBe("queued");
        const restarted = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: fixtureDownload,
        });
        const nextWorker = yield* restarted.start();
        yield* waitFor(restarted, second.id, "completed");
        yield* restarted.retry(first.id);
        yield* waitFor(restarted, first.id, "completed");
        yield* Fiber.interrupt(nextWorker);
      }),
    );
  });

  it("recovers a persisted interrupted job after reopening SQLite and clears its staging files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-download-restart-"));
    try {
      const job = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const tools = createMediaTools({ dataDirectory: directory });
            const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
              preview,
              download: fixtureDownload,
            });
            const record = yield* jobs.enqueue(firstUrl, "video-720p");
            database
              .update(downloadJobs)
              .set({ status: "running", ownerPid: null })
              .where(eq(downloadJobs.id, record.id))
              .run();
            yield* Effect.promise(async () => {
              await mkdir(join(directory, "downloads", record.id), { recursive: true });
              await writeFile(
                join(directory, "downloads", record.id, "partial"),
                "partial download",
              );
            });
            return record;
          }),
        ),
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const tools = createMediaTools({ dataDirectory: directory });
            const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
              preview,
              download: (url, path, update, preset) => {
                expect(preset).toBe("video-720p");
                return fixtureDownload(url, path, update, preset);
              },
            });
            const worker = yield* jobs.start();
            expect((yield* jobs.get(job.id)).status).toBe("interrupted");
            expect((yield* jobs.get(job.id)).preset).toBe("video-720p");
            expect(
              yield* Effect.promise(() =>
                stat(join(directory, "downloads", job.id)).catch(() => null),
              ),
            ).toBeNull();
            yield* jobs.retry(job.id);
            yield* waitFor(jobs, job.id, "completed");
            yield* Fiber.interrupt(worker);
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("reconciles media published before a crash without downloading it again", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: () =>
            Effect.fail(new MediaError("unavailable", "This download must not run again.")),
        });
        const job = yield* jobs.enqueue(firstUrl);
        const staging = join(directory, "downloads", job.id);
        const path = join(staging, "media.wav");
        yield* Effect.promise(async () => {
          await mkdir(staging, { recursive: true });
          await copyFile(wavePath, path);
          await writeFile(join(staging, "source.info.json"), "temporary metadata");
        });
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        const media = yield* library.adoptDownload(path, "Already saved", firstUrl, job.id);
        database
          .update(downloadJobs)
          .set({ status: "running", phase: "saving", ownerPid: null })
          .where(eq(downloadJobs.id, job.id))
          .run();
        const worker = yield* jobs.start();
        expect(yield* jobs.get(job.id)).toMatchObject({
          status: "completed",
          title: media.title,
          durationSeconds: media.durationSeconds,
          downloadedBytes: media.byteSize,
          mediaId: media.id,
        });
        expect(yield* Effect.promise(() => stat(staging).catch(() => null))).toBeNull();
        expect((yield* library.list()).length).toBe(1);
        yield* Fiber.interrupt(worker);
      }),
    );
  });

  it("refuses a downloaded path outside its job directory and preserves that file", async ({
    signal,
  }) => {
    await withJobs(signal, (database, directory) =>
      Effect.gen(function* () {
        const original = join(directory, "original.wav");
        yield* Effect.promise(() => copyFile(wavePath, original));
        const tools = createMediaTools({ dataDirectory: directory });
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download: (url) =>
            preview(url).pipe(Effect.map((result) => ({ path: original, preview: result }))),
        });
        const job = yield* jobs.enqueue(firstUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "failed");
        expect((yield* jobs.get(job.id)).error).toContain("outside");
        expect(yield* Effect.promise(() => readFile(original))).toEqual(
          yield* Effect.promise(() => readFile(wavePath)),
        );
        yield* Fiber.interrupt(worker);
      }),
    );
  });
});
