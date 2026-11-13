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
import type { Transcript } from "../../../../src/shared/contracts/transcriptions.ts";
import {
  createTranscriptions,
  type Transcriptions,
} from "../../../../src/server/transcriptions/jobs.ts";
import { blockCleanup } from "../../../helpers/block-cleanup.ts";
import { eq } from "drizzle-orm";
import {
  transcriptChanges,
  transcriptionJobs,
} from "../../../../src/server/transcriptions/transcriptions.schema.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
const transcript = {
  language: "en",
  words: [
    ...timedWords(100, 900, "A saved passage."),
    ...timedWords(1000, 1800, "Another passage."),
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
                  words: [{ startMs: 1000, endMs: 100, text: "Invalid" }],
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
        words: timedWords(0, 1500, "A replacement passage."),
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

const wordTexts = (job: { transcript: { words: readonly { text: string }[] } | null } | null) =>
  job?.transcript?.words.map((word) => word.text).join(" ");

const completingJobs = (database: AppDatabase, directory: string, tools: MediaTools) =>
  createTranscriptions(database, { dataDirectory: directory }, tools, {
    check: () => Effect.void,
    transcribe: (_path, _staging, _update, reportDevice) =>
      Effect.sync(() => {
        reportDevice(device);
        return transcript;
      }),
  });

it("edits, replaces and restores a transcript while keeping search and history current", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, library, media) =>
    Effect.gen(function* () {
      const jobs = completingJobs(database, directory, tools);
      yield* jobs.enqueue(media.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");
      expect(yield* jobs.get(media.id)).toMatchObject({ revision: 1, resultRevision: 1 });

      const edited = yield* jobs.edit(
        media.id,
        { revision: 1, firstWord: 0, wordCount: 3, text: "A corrected passage." },
        "app",
      );
      expect(edited?.revision).toBe(2);
      expect(wordTexts(edited)).toBe("A corrected passage. Another passage.");
      expect((yield* library.browse({ q: "corrected" })).items).toHaveLength(1);
      expect((yield* library.browse({ q: "saved" })).items).toHaveLength(0);

      const replaced = yield* jobs.replace(
        media.id,
        { revision: 2, find: "PASSAGE", replacement: "section" },
        "mcp",
      );
      expect(wordTexts(replaced)).toBe("A corrected section. Another section.");
      expect(
        yield* jobs.edit(media.id, { revision: 3, firstWord: 0, wordCount: 1, text: "A" }, "app"),
      ).toEqual(replaced);

      const stale = yield* Effect.flip(
        jobs.edit(media.id, { revision: 2, firstWord: 0, wordCount: 1, text: "The" }, "app"),
      );
      expect(stale.reason).toBe("conflict");
      const outside = yield* Effect.flip(
        jobs.edit(media.id, { revision: 3, firstWord: 4, wordCount: 2, text: "x" }, "app"),
      );
      expect(outside.reason).toBe("invalid");

      expect(yield* jobs.history(media.id, { limit: 10, offset: 0 })).toMatchObject({
        total: 2,
        changes: [
          {
            revision: 3,
            kind: "replace",
            source: "mcp",
            replacementCount: 2,
            before: "passage.",
            after: "section.",
          },
          { revision: 2, kind: "edit", source: "app", before: "saved", after: "corrected" },
        ],
      });

      const restored = yield* jobs.restore(media.id, { revision: 3, target: 1 }, "app");
      expect(restored?.revision).toBe(4);
      expect(restored?.transcript).toEqual(transcript);
      expect((yield* library.browse({ q: "saved" })).items).toHaveLength(1);
      expect(yield* jobs.history(media.id, { limit: 1, offset: 0 })).toMatchObject({
        total: 3,
        changes: [{ revision: 4, kind: "restore", restoredRevision: 1, restored: null }],
      });
      expect(wordTexts(yield* jobs.restore(media.id, { revision: 4, target: 3 }, "app"))).toBe(
        "A corrected section. Another section.",
      );
      expect(yield* jobs.history(media.id, { limit: 1, offset: 0 })).toMatchObject({
        total: 2,
        changes: [{ revision: 3, kind: "replace" }],
      });
      for (const target of [0, 4, 6]) {
        const outsideHistory = yield* Effect.flip(
          jobs.restore(media.id, { revision: 5, target }, "app"),
        );
        expect(outsideHistory.reason).toBe("invalid");
      }

      yield* jobs.removeMedia(media.id);
      expect(yield* library.list()).toEqual([]);
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("keeps one restore while switching versions and resolves restores of restores", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, _library, media) =>
    Effect.gen(function* () {
      const jobs = completingJobs(database, directory, tools);
      yield* jobs.enqueue(media.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");
      const restoreTo = (revision: number, target: number) =>
        jobs.restore(media.id, { revision, target }, "app");
      const changes = () =>
        Effect.map(jobs.history(media.id, { limit: 10, offset: 0 }), (page) => page.changes);
      const patchSizes = () =>
        database
          .select({ patch: transcriptChanges.patch })
          .from(transcriptChanges)
          .all()
          .map(({ patch }) =>
            patch.map(({ removed, inserted }) => removed.length + inserted.length),
          );

      yield* jobs.edit(
        media.id,
        { revision: 1, firstWord: 3, wordCount: 2, text: "Another section." },
        "app",
      );
      expect(wordTexts(yield* restoreTo(2, 1))).toBe("A saved passage. Another passage.");
      expect(wordTexts(yield* restoreTo(3, 2))).toBe("A saved passage. Another section.");
      expect(yield* changes()).toMatchObject([{ revision: 2, kind: "edit" }]);

      yield* restoreTo(4, 1);
      yield* jobs.edit(media.id, { revision: 5, firstWord: 1, wordCount: 1, text: "kept" }, "app");
      expect(wordTexts(yield* restoreTo(6, 5))).toBe("A saved passage. Another passage.");
      expect((yield* changes())[0]).toMatchObject({
        revision: 7,
        kind: "restore",
        restoredRevision: 1,
        restored: null,
      });
      expect(wordTexts(yield* restoreTo(7, 2))).toBe("A saved passage. Another section.");
      expect(yield* changes()).toMatchObject([
        {
          revision: 8,
          kind: "restore",
          restoredRevision: 2,
          restored: { kind: "edit", before: "passage.", after: "section." },
        },
        { revision: 6, kind: "edit" },
        { revision: 5, kind: "restore", restoredRevision: 1, restored: null },
        { revision: 2, kind: "edit" },
      ]);
      expect(patchSizes()).toEqual([[2], [2], [2], [2, 2]]);
      expect(yield* restoreTo(8, 2)).toMatchObject({ revision: 8 });
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("rejects edits during a new attempt and never reuses a revision after it completes", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, _library, media) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      let attempts = 0;
      const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: (_path, _staging, _update, reportDevice) =>
          Effect.gen(function* () {
            if (++attempts > 1) yield* Deferred.await(release);
            reportDevice(device);
            return transcript;
          }),
      });
      yield* jobs.enqueue(media.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");
      yield* jobs.replace(media.id, { revision: 1, find: "passage", replacement: "part" }, "app");
      expect((yield* jobs.retry(media.id))?.revision).toBe(2);
      const during = yield* Effect.flip(
        jobs.replace(media.id, { revision: 2, find: "part", replacement: "piece" }, "app"),
      );
      expect(during.reason).toBe("conflict");
      yield* Deferred.succeed(release, undefined);
      yield* waitFor(jobs, media.id, "completed");
      expect(yield* jobs.get(media.id)).toMatchObject({
        revision: 3,
        resultRevision: 3,
        transcript,
      });
      expect(yield* jobs.history(media.id, { limit: 10, offset: 0 })).toEqual({
        changes: [],
        total: 0,
      });
      for (const revision of [1, 2]) {
        const earlier = yield* Effect.flip(
          jobs.edit(media.id, { revision, firstWord: 0, wordCount: 1, text: "The" }, "mcp"),
        );
        expect(earlier.reason).toBe("conflict");
      }
      yield* Fiber.interrupt(worker);
    }),
  );
});

const speakersOf = (job: { transcript: Transcript | null } | null) =>
  job?.transcript?.words.map((word) => word.speaker);

it("assigns, merges and names speakers, keeping names apart from the history it restores", async ({
  signal,
}) => {
  await withRecording(signal, (database, directory, tools, _library, media) =>
    Effect.gen(function* () {
      const spoken = {
        ...transcript,
        words: transcript.words.map((word, index) => ({ ...word, speaker: index < 3 ? 1 : 2 })),
      };
      const jobs = createTranscriptions(database, { dataDirectory: directory }, tools, {
        check: () => Effect.void,
        transcribe: (_path, _staging, _update, reportDevice) =>
          Effect.sync(() => {
            reportDevice(device);
            return spoken;
          }),
      });
      yield* jobs.enqueue(media.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");

      const named = yield* jobs.renameSpeaker(media.id, { speaker: 2, name: "  Ann  " });
      expect(named).toMatchObject({
        revision: 1,
        transcript: { speakers: [{ id: 2, name: "Ann" }] },
      });
      expect(
        (yield* Effect.flip(jobs.renameSpeaker(media.id, { speaker: 3, name: "Bob" }))).reason,
      ).toBe("invalid");

      const assigned = yield* jobs.assignSpeaker(
        media.id,
        { revision: 1, firstWord: 3, wordCount: 2, speaker: 3 },
        "app",
      );
      expect(assigned?.revision).toBe(2);
      expect(speakersOf(assigned)).toEqual([1, 1, 1, 3, 3]);
      expect(assigned?.transcript?.speakers).toEqual([{ id: 2, name: "Ann" }]);
      for (const request of [
        { revision: 2, firstWord: 0, wordCount: 1, speaker: 5 },
        { revision: 2, firstWord: 4, wordCount: 2, speaker: 1 },
      ])
        expect((yield* Effect.flip(jobs.assignSpeaker(media.id, request, "app"))).reason).toBe(
          "invalid",
        );

      const merged = yield* jobs.mergeSpeakers(
        media.id,
        { revision: 2, speaker: 3, into: 2 },
        "mcp",
      );
      expect(speakersOf(merged)).toEqual([1, 1, 1, 2, 2]);
      for (const request of [
        { revision: 3, speaker: 1, into: 1 },
        { revision: 3, speaker: 1, into: 4 },
        { revision: 3, speaker: 1, into: 3 },
        { revision: 3, speaker: 3, into: 1 },
      ])
        expect((yield* Effect.flip(jobs.mergeSpeakers(media.id, request, "app"))).reason).toBe(
          "invalid",
        );
      expect(
        (yield* Effect.flip(
          jobs.assignSpeaker(
            media.id,
            { revision: 3, firstWord: 0, wordCount: 1, speaker: 4 },
            "app",
          ),
        )).message,
      ).toBe("Choose a speaker from the transcript, or 3 for a new speaker.");
      expect(yield* jobs.history(media.id, { limit: 10, offset: 0 })).toMatchObject({
        total: 2,
        changes: [
          { revision: 3, kind: "speaker", source: "mcp", replacementCount: 1 },
          {
            revision: 2,
            kind: "speaker",
            source: "app",
            startMs: transcript.words[3]?.startMs,
            before: "Another passage.",
            after: "Another passage.",
          },
        ],
      });

      const restored = yield* jobs.restore(media.id, { revision: 3, target: 2 }, "app");
      expect(restored).toMatchObject({
        revision: 4,
        transcript: { speakers: [{ id: 2, name: "Ann" }] },
      });
      expect(speakersOf(restored)).toEqual([1, 1, 1, 3, 3]);
      const cleared = yield* jobs.renameSpeaker(media.id, { speaker: 2, name: " " });
      expect(cleared?.revision).toBe(4);
      expect(cleared?.transcript).not.toHaveProperty("speakers");
      yield* Fiber.interrupt(worker);
    }),
  );
});
