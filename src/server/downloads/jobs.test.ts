import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber, type Scope } from "effect";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase, type AppDatabase } from "../db/database.ts";
import { createMediaLibrary } from "../media/library.ts";
import { MediaError } from "../media/error.ts";
import { createMediaTools } from "../media-tools/tools.ts";
import { createDownloads, type Downloads } from "./jobs.ts";
import { downloadJobs } from "./downloads.schema.ts";
import type { YoutubeDownloader } from "./ytdlp.ts";

const firstUrl = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const secondUrl = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
const wavePath = new URL("../../../tests/fixtures/tone.wav", import.meta.url);
const preview = (url: string) =>
  Effect.succeed({ url, title: "A controlled source recording", durationSeconds: 2 });
const fixtureDownload: YoutubeDownloader["download"] = (url, directory, update) =>
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
  test: (database: AppDatabase, directory: string) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-download-jobs-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          yield* test(database, directory);
        }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const waitFor = (jobs: Downloads, id: string, status: string) =>
  Effect.promise(async () => {
    await expect
      .poll(async () => (await Effect.runPromise(jobs.get(id))).status, { timeout: 10000 })
      .toBe(status);
  });

describe("persistent download jobs", () => {
  it("claims a queued download, publishes a real media file and prevents duplicate URL jobs", async () => {
    await withJobs((database, directory) =>
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

  it("runs one download at a time, cancels its process work and continues with the next job", async () => {
    await withJobs((database, directory) =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        let active = 0;
        let maximum = 0;
        let cleaned = false;
        const tools = createMediaTools({ dataDirectory: directory });
        const download: YoutubeDownloader["download"] = (url, path, update) =>
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

  it("retries a failed job without losing its identity or publishing partial media", async () => {
    await withJobs((database, directory) =>
      Effect.gen(function* () {
        let attempts = 0;
        const tools = createMediaTools({ dataDirectory: directory });
        const download: YoutubeDownloader["download"] = (url, path, update) =>
          ++attempts === 1
            ? Effect.fail(new MediaError("unavailable", "The source is temporarily unavailable."))
            : fixtureDownload(url, path, update);
        const jobs = createDownloads(database, { dataDirectory: directory }, tools, {
          preview,
          download,
        });
        const job = yield* jobs.enqueue(firstUrl);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, job.id, "failed");
        expect((yield* jobs.get(job.id)).error).toBe("The source is temporarily unavailable.");
        expect((yield* jobs.retry(job.id)).id).toBe(job.id);
        yield* waitFor(jobs, job.id, "completed");
        expect(attempts).toBe(2);
        expect((yield* jobs.list()).length).toBe(1);
        yield* Fiber.interrupt(worker);
      }),
    );
  });

  it("marks running work interrupted on shutdown while preserving queued work", async () => {
    await withJobs((database, directory) =>
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
            const record = yield* jobs.enqueue(firstUrl);
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
              download: fixtureDownload,
            });
            const worker = yield* jobs.start();
            expect((yield* jobs.get(job.id)).status).toBe("interrupted");
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

  it("reconciles media published before a crash without downloading it again", async () => {
    await withJobs((database, directory) =>
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

  it("refuses a downloaded path outside its job directory and preserves that file", async () => {
    await withJobs((database, directory) =>
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
