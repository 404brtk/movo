import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber, type Scope } from "effect";
import { eq } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createDownloads } from "../../../../src/server/downloads/jobs.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { downloadJobs } from "../../../../src/server/downloads/downloads.schema.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const audio = new URL("../../../fixtures/tone.wav", import.meta.url);
const transcript = {
  language: "en",
  words: [...timedWords(100, 900, "A downloaded recording.")],
};
const downloader = {
  preview: (sourceUrl: string) =>
    Effect.succeed({ url: sourceUrl, title: "Downloaded recording", durationSeconds: 2 }),
  download: (sourceUrl: string, directory: string) =>
    Effect.gen(function* () {
      const path = join(directory, "media.wav");
      yield* Effect.promise(() => copyFile(audio, path));
      return { path, preview: yield* downloader.preview(sourceUrl) };
    }),
};

async function withDownloads(
  signal: AbortSignal,
  test: (database: AppDatabase, directory: string) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-download-transcription-"));
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

it("queues transcription with download completion and retains the saved recording", async ({
  signal,
}) => {
  await withDownloads(signal, (database, directory) =>
    Effect.gen(function* () {
      const tools = createMediaTools({ dataDirectory: directory });
      const downloads = createDownloads(database, { dataDirectory: directory }, tools, downloader);
      const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      const job = yield* downloads.enqueue(url, "audio", true);
      expect(job.transcribe).toBe(true);
      const downloadWorker = yield* downloads.start();
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
          .toBe("completed");
      });
      expect((yield* transcriptions.get(job.id))?.status).toBe("queued");
      const transcriptionWorker = yield* transcriptions.start();
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(transcriptions.get(job.id)))?.status)
          .toBe("completed");
      });
      expect((yield* transcriptions.get(job.id))?.transcript).toEqual(transcript);
      const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
      const saved = yield* library.file(job.id);
      expect(yield* Effect.promise(() => readFile(saved.path))).toEqual(
        yield* Effect.promise(() => readFile(audio)),
      );
      yield* Fiber.interrupt(downloadWorker);
      yield* Fiber.interrupt(transcriptionWorker);
      expect(yield* Effect.promise(() => readdir(join(directory, "downloads")))).toEqual([]);
      expect(yield* Effect.promise(() => readdir(join(directory, "transcriptions")))).toEqual([]);
    }),
  );
});

it("observes transcription requested while a download is already running", async ({ signal }) => {
  await withDownloads(signal, (database, directory) =>
    Effect.gen(function* () {
      const tools = createMediaTools({ dataDirectory: directory });
      const began = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const downloads = createDownloads(database, { dataDirectory: directory }, tools, {
        ...downloader,
        download: (source, staging) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(began, undefined);
            yield* Deferred.await(release);
            return yield* downloader.download(source, staging);
          }),
      });
      const job = yield* downloads.enqueue(url, "audio");
      const worker = yield* downloads.start();
      yield* Deferred.await(began);
      expect((yield* downloads.enqueue(url, "audio", true)).id).toBe(job.id);
      yield* Deferred.succeed(release, undefined);
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
          .toBe("completed");
      });
      const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      expect((yield* transcriptions.get(job.id))?.status).toBe("queued");
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("rolls back download completion when transcription cannot be queued and recovers without downloading again", async ({
  signal,
}) => {
  await withDownloads(signal, (database, directory) =>
    Effect.gen(function* () {
      const tools = createMediaTools({ dataDirectory: directory });
      let attempts = 0;
      const downloads = createDownloads(database, { dataDirectory: directory }, tools, {
        ...downloader,
        download: (source, staging) => {
          attempts++;
          return downloader.download(source, staging);
        },
      });
      const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      database.$client.exec(
        "CREATE TRIGGER reject_auto_transcription BEFORE INSERT ON transcription_jobs BEGIN SELECT RAISE(ABORT, 'Cannot queue transcription'); END;",
      );
      const job = yield* downloads.enqueue(url, "audio", true);
      const worker = yield* downloads.start();
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
          .toBe("failed");
      });
      expect((yield* downloads.get(job.id)).mediaId).toBeNull();
      expect(yield* transcriptions.get(job.id)).toBeNull();
      const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
      expect(yield* library.file(job.id)).toBeDefined();
      database.$client.exec("DROP TRIGGER reject_auto_transcription");
      yield* downloads.retry(job.id);
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
          .toBe("completed");
      });
      expect((yield* transcriptions.get(job.id))?.status).toBe("queued");
      expect(attempts).toBe(1);
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("adds transcription to an existing download without duplicating media or restarting cancelled transcription", async ({
  signal,
}) => {
  await withDownloads(signal, (database, directory) =>
    Effect.gen(function* () {
      const tools = createMediaTools({ dataDirectory: directory });
      let downloadsStarted = 0;
      const downloads = createDownloads(database, { dataDirectory: directory }, tools, {
        ...downloader,
        download: (source, staging) => {
          downloadsStarted++;
          return downloader.download(source, staging);
        },
      });
      const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      const job = yield* downloads.enqueue(url, "audio");
      const worker = yield* downloads.start();
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
          .toBe("completed");
      });
      expect(yield* transcriptions.get(job.id)).toBeNull();
      expect((yield* downloads.enqueue(url, "audio", true)).id).toBe(job.id);
      expect((yield* downloads.enqueue(url, "audio", false)).transcribe).toBe(true);
      expect((yield* transcriptions.get(job.id))?.status).toBe("queued");
      yield* transcriptions.cancel(job.id);
      yield* downloads.enqueue(url, "audio", true);
      expect((yield* transcriptions.get(job.id))?.status).toBe("cancelled");
      expect(downloadsStarted).toBe(1);
      expect(
        yield* createMediaLibrary(database, directory, () => tools.resolve("ffprobe")).list(),
      ).toHaveLength(1);
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("recovers transcription when the media was saved before download completion was recorded", async ({
  signal,
}) => {
  await withDownloads(signal, (database, directory) =>
    Effect.gen(function* () {
      const tools = createMediaTools({ dataDirectory: directory });
      const downloads = createDownloads(database, { dataDirectory: directory }, tools, downloader);
      const job = yield* downloads.enqueue(url, "audio", true);
      const staging = join(directory, "downloads", job.id);
      yield* Effect.promise(() => mkdir(staging, { recursive: true }));
      const result = yield* downloader.download(url, staging);
      const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
      yield* library.adoptDownload(result.path, result.preview.title, url, job.id);
      database
        .update(downloadJobs)
        .set({ status: "running", phase: "saving" })
        .where(eq(downloadJobs.id, job.id))
        .run();
      const restarted = createDownloads(database, { dataDirectory: directory }, tools, {
        ...downloader,
        download: () =>
          Effect.fail(new MediaError("unavailable", "The recording must not be downloaded again.")),
      });
      const worker = yield* restarted.start();
      const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      expect((yield* restarted.get(job.id)).status).toBe("completed");
      expect((yield* transcriptions.get(job.id))?.status).toBe("queued");
      yield* Fiber.interrupt(worker);
    }),
  );
});

it.for(["failed", "cancelled"] as const)(
  "retains transcription intent through a %s download and retry",
  async (outcome, { signal }) => {
    await withDownloads(signal, (database, directory) =>
      Effect.gen(function* () {
        const tools = createMediaTools({ dataDirectory: directory });
        let fail = true;
        const downloads = createDownloads(database, { dataDirectory: directory }, tools, {
          ...downloader,
          download: (source, staging) =>
            fail
              ? outcome === "failed"
                ? Effect.fail(new MediaError("unavailable", "Source unavailable."))
                : Effect.never
              : downloader.download(source, staging),
        });
        const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
          check: () => Effect.void,
          transcribe: () => Effect.succeed(transcript),
        });
        const job = yield* downloads.enqueue(url, "audio", true);
        const worker = yield* downloads.start();
        yield* Effect.promise(async () => {
          await expect
            .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
            .toBe(outcome === "cancelled" ? "running" : "failed");
        });
        if (outcome === "cancelled") yield* downloads.cancel(job.id);
        expect((yield* downloads.get(job.id)).status).toBe(outcome);
        expect(
          yield* createMediaLibrary(database, directory, () => tools.resolve("ffprobe")).list(),
        ).toEqual([]);
        fail = false;
        expect((yield* downloads.retry(job.id)).transcribe).toBe(true);
        yield* Effect.promise(async () => {
          await expect
            .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
            .toBe("completed");
        });
        expect((yield* transcriptions.get(job.id))?.status).toBe("queued");
        yield* Fiber.interrupt(worker);
      }),
    );
  },
);

it("keeps a completed download when transcription fails and retries transcription without downloading again", async ({
  signal,
}) => {
  await withDownloads(signal, (database, directory) =>
    Effect.gen(function* () {
      const tools = createMediaTools({ dataDirectory: directory });
      const downloads = createDownloads(database, { dataDirectory: directory }, tools, downloader);
      let fail = true;
      const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () =>
          fail
            ? Effect.fail(new MediaError("unavailable", "Model unavailable."))
            : Effect.succeed(transcript),
      });
      const job = yield* downloads.enqueue(url, "audio", true);
      const downloadWorker = yield* downloads.start();
      const transcriptionWorker = yield* transcriptions.start();
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
          .toBe("completed");
      });
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(transcriptions.get(job.id)))?.status)
          .toBe("failed");
      });
      expect((yield* downloads.get(job.id)).status).toBe("completed");
      fail = false;
      yield* transcriptions.retry(job.id);
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(transcriptions.get(job.id)))?.status)
          .toBe("completed");
      });
      expect((yield* transcriptions.get(job.id))?.transcript).toEqual(transcript);
      yield* Fiber.interrupt(downloadWorker);
      yield* Fiber.interrupt(transcriptionWorker);
    }),
  );
});
