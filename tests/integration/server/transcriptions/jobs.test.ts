import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber, Result, type Scope } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools, type MediaTools } from "../../../../src/server/media-tools/tools.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import type { MediaItem } from "../../../../src/shared/contracts/media.ts";
import {
  createTranscriptions,
  type Transcriptions,
} from "../../../../src/server/transcriptions/jobs.ts";
import { blockCleanup } from "../../../helpers/block-cleanup.ts";
import { eq } from "drizzle-orm";
import { transcriptionJobs } from "../../../../src/server/transcriptions/transcriptions.schema.ts";

const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
const transcript = {
  language: "en",
  segments: [
    { startMs: 100, endMs: 900, text: "A saved passage." },
    { startMs: 1000, endMs: 1800, text: "Another passage." },
  ],
};
const device = { backend: "cpu", name: "Test CPU" };

async function withRecording(
  signal: AbortSignal,
  test: (
    database: AppDatabase,
    directory: string,
    tools: MediaTools,
    library: ReturnType<typeof createMediaLibrary>,
    media: MediaItem,
  ) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-transcriptions-"));
  const running = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* openDatabase(join(directory, "app.sqlite"));
        const tools = createMediaTools({ dataDirectory: directory });
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        const media = yield* library.import(
          new Response(audio).body,
          "recording.wav",
          audio.length,
        );
        yield* test(database, directory, tools, library, media);
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

const waitFor = (jobs: Transcriptions, id: string, status: string) =>
  Effect.promise(async () => {
    await expect
      .poll(async () => (await Effect.runPromise(jobs.get(id)))?.status, { timeout: 10000 })
      .toBe(status);
  });

it("waits for concurrent cancellation to stop inference before deleting a recording", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, library, media) =>
    Effect.gen(function* () {
      const began = yield* Deferred.make<void>();
      const stopping = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(began, undefined);
            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Deferred.succeed(stopping, undefined);
                yield* Deferred.await(release);
              }),
            ),
          ),
      });
      yield* jobs.enqueue(media.id);
      expect(Result.isFailure(yield* Effect.result(jobs.removeMedia(media.id)))).toBe(true);
      const worker = yield* jobs.start();
      yield* Deferred.await(began);
      const cancelling = yield* Effect.forkChild(jobs.cancel(media.id));
      yield* Deferred.await(stopping);
      const removing = yield* Effect.forkChild(jobs.removeMedia(media.id));
      yield* Effect.yieldNow;
      expect(yield* library.get(media.id)).toEqual(media);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(cancelling);
      expect(yield* Fiber.join(removing)).toEqual(media);
      expect(yield* library.list()).toEqual([]);
      expect(database.select().from(transcriptionJobs).all()).toEqual([]);
      expect(
        yield* Effect.promise(() =>
          stat(join(directory, "transcriptions", media.id)).catch(() => null),
        ),
      ).toBeNull();
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("queues once per recording, saves timestamped passages and preserves the media bytes", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, library, media) =>
    Effect.gen(function* () {
      const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: (_path, staging) =>
          Effect.promise(async () => {
            await writeFile(join(staging, "audio.f32"), "prepared audio");
            return transcript;
          }),
      });
      expect(yield* jobs.get(media.id)).toBeNull();
      expect((yield* jobs.enqueue(media.id)).status).toBe("queued");
      expect((yield* jobs.enqueue(media.id)).status).toBe("queued");
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");
      expect((yield* jobs.get(media.id))?.transcript).toEqual(transcript);
      const saved = yield* library.file(media.id);
      expect(yield* Effect.promise(() => readFile(saved.path))).toEqual(audio);
      yield* Fiber.interrupt(worker);
      expect(
        yield* Effect.promise(() =>
          stat(join(directory, "transcriptions", media.id)).catch(() => null),
        ),
      ).toBeNull();
    }),
  );
});

it("stops active inference before cleanup, continues the queue and accepts only one concurrent retry", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, library, media) =>
    Effect.gen(function* () {
      const second = yield* library.import(new Response(audio).body, "second.wav", audio.length);
      const began = yield* Deferred.make<void>();
      let attempts = 0;
      let stopped = false;
      const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: (_path, staging, update, reportDevice) =>
          Effect.gen(function* () {
            attempts++;
            yield* Effect.promise(() => writeFile(join(staging, "audio.f32"), "partial audio"));
            reportDevice(device);
            update("transcribing");
            if (attempts === 1) {
              yield* Deferred.succeed(began, undefined);
              yield* Effect.never;
            }
            return transcript;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                stopped = true;
              }),
            ),
          ),
      });
      yield* jobs.enqueue(media.id);
      yield* jobs.enqueue(second.id);
      const worker = yield* jobs.start();
      yield* Deferred.await(began);
      expect((yield* jobs.get(second.id))?.status).toBe("queued");
      yield* jobs.cancel(media.id);
      expect(stopped).toBe(true);
      expect(yield* jobs.get(media.id)).toMatchObject({ status: "cancelled", device });
      expect(
        yield* Effect.promise(() =>
          stat(join(directory, "transcriptions", media.id)).catch(() => null),
        ),
      ).toBeNull();
      yield* waitFor(jobs, second.id, "completed");
      const retries = yield* Effect.all(
        [Effect.result(jobs.retry(media.id)), Effect.result(jobs.retry(media.id))],
        { concurrency: "unbounded" },
      );
      expect(retries.filter(Result.isSuccess)).toMatchObject([{ success: { device: null } }]);
      expect(retries.filter(Result.isFailure)).toMatchObject([{ failure: { reason: "invalid" } }]);
      yield* waitFor(jobs, media.id, "completed");
      expect(attempts).toBe(3);
      expect(yield* jobs.get(media.id)).toMatchObject({ transcript, device });
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("rejects missing prerequisites without queuing and rejects malformed engine results without stopping other jobs", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, library, media) =>
    Effect.gen(function* () {
      let available = false;
      let attempts = 0;
      const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () =>
          available
            ? Effect.void
            : Effect.fail(new MediaError("unavailable", "Download the model first.")),
        transcribe: () =>
          Effect.succeed(
            ++attempts === 1
              ? {
                  language: null,
                  segments: [{ startMs: 1000, endMs: 100, text: "Invalid timing" }],
                }
              : transcript,
          ),
      });
      expect(yield* Effect.result(jobs.enqueue(media.id))).toMatchObject({
        _tag: "Failure",
        failure: { reason: "unavailable" },
      });
      expect(yield* jobs.get(media.id)).toBeNull();
      available = true;
      yield* jobs.enqueue(media.id);
      const second = yield* library.import(new Response(audio).body, "second.wav", audio.length);
      yield* jobs.enqueue(second.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "failed");
      expect((yield* jobs.get(media.id))?.transcript).toBeNull();
      yield* waitFor(jobs, second.id, "completed");
      yield* jobs.retry(media.id);
      yield* waitFor(jobs, media.id, "completed");
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("persists interrupted and queued jobs across reopening SQLite and preserves completed transcripts", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, library, media) =>
    Effect.gen(function* () {
      const second = yield* library.import(new Response(audio).body, "second.wav", audio.length);
      const first = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.never,
      });
      yield* first.enqueue(media.id);
      yield* first.enqueue(second.id);
      const worker = yield* first.start();
      yield* waitFor(first, media.id, "running");
      yield* Fiber.interrupt(worker);
      const reopened = yield* openDatabase(join(directory, "app.sqlite"));
      const jobs = createTranscriptions(reopened, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      expect((yield* jobs.get(media.id))?.status).toBe("interrupted");
      expect((yield* jobs.get(second.id))?.status).toBe("queued");
      reopened
        .update(transcriptionJobs)
        .set({ status: "running", phase: "transcribing" })
        .where(eq(transcriptionJobs.mediaId, media.id))
        .run();
      const restarted = yield* jobs.start();
      yield* waitFor(jobs, second.id, "completed");
      expect((yield* jobs.get(media.id))?.status).toBe("interrupted");
      yield* jobs.retry(media.id);
      yield* waitFor(jobs, media.id, "completed");
      yield* Fiber.interrupt(restarted);
      const third = yield* openDatabase(join(directory, "app.sqlite"));
      const saved = createTranscriptions(third, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: () => Effect.succeed(transcript),
      });
      expect((yield* saved.get(media.id))?.transcript).toEqual(transcript);
    }),
  );
});

it("keeps the previous transcript through failed, cancelled and interrupted replacements until one completes", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, _library, media) =>
    Effect.gen(function* () {
      const replacement = {
        language: "en",
        segments: [{ startMs: 0, endMs: 1500, text: "A replacement passage." }],
      };
      let attempts = 0;
      const attemptStarted = (attempt: number) =>
        Effect.promise(async () => {
          await expect.poll(() => attempts, { timeout: 10000 }).toBe(attempt);
        });
      const first = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: (_path, _staging, _update, reportDevice) =>
          Effect.gen(function* () {
            attempts++;
            reportDevice(device);
            if (attempts === 1) return transcript;
            if (attempts === 2)
              return yield* Effect.fail(new MediaError("unavailable", "The engine stopped."));
            return yield* Effect.never;
          }),
      });
      expect(yield* Effect.result(first.retry(media.id))).toMatchObject({
        _tag: "Failure",
        failure: { reason: "invalid" },
      });
      yield* first.enqueue(media.id);
      const worker = yield* first.start();
      yield* waitFor(first, media.id, "completed");
      expect(yield* first.enqueue(media.id)).toMatchObject({ status: "completed", transcript });
      const retries = yield* Effect.all(
        [Effect.result(first.retry(media.id)), Effect.result(first.retry(media.id))],
        { concurrency: "unbounded" },
      );
      expect(retries.filter(Result.isSuccess)).toMatchObject([
        { success: { transcript, device: null } },
      ]);
      expect(retries.filter(Result.isFailure)).toMatchObject([{ failure: { reason: "invalid" } }]);
      yield* waitFor(first, media.id, "failed");
      expect(yield* first.get(media.id)).toMatchObject({
        transcript,
        device,
        error: "The engine stopped.",
      });
      yield* first.retry(media.id);
      yield* attemptStarted(3);
      expect(yield* first.get(media.id)).toMatchObject({ status: "running", transcript });
      expect(yield* first.cancel(media.id)).toMatchObject({ status: "cancelled", transcript });
      yield* first.retry(media.id);
      yield* attemptStarted(4);
      yield* Fiber.interrupt(worker);
      const reopened = yield* openDatabase(join(directory, "app.sqlite"));
      const restarted = createTranscriptions(reopened, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: (_path, _staging, _update, reportDevice) =>
          Effect.sync(() => {
            reportDevice(device);
            return replacement;
          }),
      });
      expect(yield* restarted.get(media.id)).toMatchObject({ status: "interrupted", transcript });
      expect(yield* restarted.retry(media.id)).toMatchObject({ status: "queued", transcript });
      const next = yield* restarted.start();
      yield* waitFor(restarted, media.id, "completed");
      expect(yield* restarted.get(media.id)).toMatchObject({
        transcript: replacement,
        error: null,
      });
      yield* Fiber.interrupt(next);
      expect(
        yield* Effect.promise(() =>
          stat(join(directory, "transcriptions", media.id)).catch(() => null),
        ),
      ).toBeNull();
    }),
  );
});

it.for(["completed", "failed"])(
  "isolates cleanup errors after a %s transcription and allows recovery",
  async (outcome, { signal }) => {
    await withRecording(signal, (database, directory, tools, library, media) =>
      Effect.gen(function* () {
        let release: (() => Promise<void>) | undefined;
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.promise(async () => {
            await release?.();
          }),
        );
        let attempts = 0;
        const engine = {
          check: () => Effect.void,
          transcribe: (_path: string, staging: string) =>
            Effect.gen(function* () {
              if (++attempts === 1) {
                release = yield* Effect.promise(() => blockCleanup(staging));
                if (outcome === "failed")
                  return yield* Effect.fail(new MediaError("unavailable", "The engine stopped."));
              }
              return transcript;
            }),
        };
        const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, engine);
        const second = yield* library.import(new Response(audio).body, "second.wav", audio.length);
        yield* jobs.enqueue(media.id);
        yield* jobs.enqueue(second.id);
        const worker = yield* jobs.start();
        yield* waitFor(jobs, second.id, "completed");
        expect(yield* jobs.get(media.id)).toMatchObject({
          status: outcome,
          cleanupError: expect.stringContaining("temporary transcription files"),
        });
        expect(yield* Effect.result(jobs.retry(media.id))).toMatchObject({ _tag: "Failure" });
        if (!release) throw new Error("The file lock did not start.");
        yield* Effect.promise(release);
        release = undefined;
        if (outcome === "failed") {
          yield* jobs.retry(media.id);
          yield* waitFor(jobs, media.id, "completed");
        }
        yield* Fiber.interrupt(worker);
        const restarted = createTranscriptions(
          database,
          { dataDirectory: directory },
          tools,
          engine,
        );
        const next = yield* restarted.start();
        expect(yield* restarted.get(media.id)).toMatchObject({
          status: "completed",
          cleanupError: null,
          transcript,
        });
        yield* Fiber.interrupt(next);
      }),
    );
  },
);
