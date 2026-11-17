import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber, type Scope } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools, type MediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createDictionary } from "../../../../src/server/transcriptions/dictionary.ts";
import {
  createTranscriptions,
  type Transcriptions,
} from "../../../../src/server/transcriptions/jobs.ts";
import type { DictionaryDraft } from "../../../../src/shared/contracts/dictionary.ts";
import type { MediaItem } from "../../../../src/shared/contracts/media.ts";
import type { Transcript } from "../../../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
const device = { backend: "cpu", name: "Test CPU" };
const heard: Transcript = {
  language: "en",
  words: timedWords(0, 2000, "We moved movo to para keet, not parakeets."),
};

const draft = (spelling: string, options: Partial<DictionaryDraft> = {}): DictionaryDraft => ({
  spelling,
  similar: false,
  alsoReplace: [],
  neverChange: [],
  ...options,
});

const wordTexts = (job: { transcript: { words: readonly { text: string }[] } | null } | null) =>
  job?.transcript?.words.map((word) => word.text).join(" ");

async function withRecordings(
  signal: AbortSignal,
  test: (
    database: AppDatabase,
    directory: string,
    tools: MediaTools,
    library: ReturnType<typeof createMediaLibrary>,
    media: readonly [MediaItem, MediaItem],
  ) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-dictionary-"));
  const running = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* openDatabase(join(directory, "app.sqlite"));
        const tools = createMediaTools({ dataDirectory: directory });
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        const importOne = (name: string) =>
          library.import(new Response(audio).body, name, audio.length);
        const first = yield* importOne("first.wav");
        const second = yield* importOne("second.wav");
        yield* test(database, directory, tools, library, [first, second]);
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

const completing = (
  database: AppDatabase,
  directory: string,
  tools: MediaTools,
  transcribe: () => Effect.Effect<Transcript> = () => Effect.succeed(heard),
) =>
  createTranscriptions(database, { dataDirectory: directory }, tools, {
    check: () => Effect.void,
    transcribe: (_path, _staging, _update, reportDevice) =>
      Effect.andThen(
        Effect.sync(() => reportDevice(device)),
        transcribe(),
      ),
  });

it("fixes new transcripts as their own version and keeps the model's words restorable", async ({
  signal,
}) => {
  await withRecordings(signal, (database, directory, tools, library, [media]) =>
    Effect.gen(function* () {
      const jobs = completing(database, directory, tools);
      const dictionary = createDictionary(database, jobs);
      const saved = yield* dictionary.save(null, {
        draft: draft("Parakeet", { similar: true, neverChange: ["parakeets"] }),
        fix: [],
      });
      yield* dictionary.save(null, { draft: draft("Movo"), fix: [] });
      yield* jobs.enqueue(media.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");

      const job = yield* jobs.get(media.id);
      expect(job).toMatchObject({ revision: 2, resultRevision: 1 });
      expect(wordTexts(job)).toBe("We moved Movo to Parakeet, not parakeets.");
      expect(yield* jobs.history(media.id, { limit: 10, offset: 0 })).toMatchObject({
        total: 1,
        changes: [{ revision: 2, kind: "dictionary", source: "app", replacementCount: 2 }],
      });
      expect((yield* library.browse({ q: "parakeet" })).items).toHaveLength(1);
      expect((yield* dictionary.list()).map((entry) => [entry.spelling, entry.fixes])).toEqual([
        ["Movo", 1],
        ["Parakeet", 1],
      ]);
      expect(saved.entry.fixes).toBe(0);

      const restored = yield* jobs.restore(media.id, { revision: 2, target: 1 }, "app");
      expect(restored?.transcript).toEqual(heard);
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("previews library matches and fixes only the ticked ones of saved recordings", async ({
  signal,
}) => {
  await withRecordings(signal, (database, directory, tools, _library, [first, second]) =>
    Effect.gen(function* () {
      const jobs = completing(database, directory, tools);
      const dictionary = createDictionary(database, jobs);
      yield* jobs.enqueue(first.id);
      yield* jobs.enqueue(second.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, first.id, "completed");
      yield* waitFor(jobs, second.id, "completed");
      yield* jobs.edit(
        second.id,
        { revision: 1, firstWord: 0, wordCount: 2, text: "Parakit and parakeet" },
        "app",
      );

      const parakeet = draft("Parakeet", { similar: true, neverChange: ["parakeets"] });
      const preview = yield* dictionary.preview({ id: null, draft: parakeet });
      expect(preview.hitCount).toBe(4);
      const [busiest, other] = preview.recordings;
      expect(busiest).toMatchObject({ mediaId: second.id, revision: 2, hitCount: 3 });
      expect(busiest?.hits).toEqual([
        expect.objectContaining({
          firstWord: 0,
          before: "Parakit",
          after: "Parakeet",
          leading: "",
          trailing: "and parakeet movo to para keet,",
          similar: true,
        }),
        expect.objectContaining({ firstWord: 2, before: "parakeet", after: "Parakeet" }),
        expect.objectContaining({ before: "para keet,", after: "Parakeet,", similar: true }),
      ]);
      expect(other).toMatchObject({ mediaId: first.id, revision: 1, hitCount: 1 });

      const result = yield* dictionary.save(null, {
        draft: parakeet,
        fix: [
          { mediaId: second.id, revision: 2, skip: [2] },
          { mediaId: first.id, revision: 0, skip: [] },
        ],
      });
      expect(result).toMatchObject({
        fixedWords: 2,
        fixedRecordings: 1,
        skipped: [
          {
            mediaId: first.id,
            title: "first",
            reason: "It changed after the preview. Open the entry again to review it.",
          },
        ],
      });
      expect(result.entry.fixes).toBe(2);
      expect(wordTexts(yield* jobs.get(second.id))).toBe(
        "Parakeet and parakeet movo to Parakeet, not parakeets.",
      );
      expect(yield* jobs.history(second.id, { limit: 1, offset: 0 })).toMatchObject({
        changes: [{ revision: 3, kind: "dictionary", replacementCount: 2 }],
      });
      expect(wordTexts(yield* jobs.get(first.id))).toBe(wordTexts({ transcript: heard }));
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("leaves recordings being transcribed out of the preview and names them when fixing", async ({
  signal,
}) => {
  await withRecordings(signal, (database, directory, tools, _library, [media]) =>
    Effect.gen(function* () {
      const began = yield* Deferred.make<void>();
      let attempt = 0;
      const jobs = completing(database, directory, tools, () =>
        attempt++ === 0
          ? Effect.succeed(heard)
          : Effect.andThen(Deferred.succeed(began, undefined), Effect.never),
      );
      const dictionary = createDictionary(database, jobs);
      yield* jobs.enqueue(media.id);
      const worker = yield* jobs.start();
      yield* waitFor(jobs, media.id, "completed");
      yield* jobs.retry(media.id);
      yield* Deferred.await(began);

      expect(yield* dictionary.preview({ id: null, draft: draft("Movo") })).toEqual({
        hitCount: 0,
        recordings: [],
      });
      const result = yield* dictionary.save(null, {
        draft: draft("Movo"),
        fix: [{ mediaId: media.id, revision: 1, skip: [] }],
      });
      expect(result).toMatchObject({
        fixedWords: 0,
        fixedRecordings: 0,
        skipped: [
          {
            mediaId: media.id,
            reason: "It's being transcribed again, and its new transcript will use the dictionary.",
          },
        ],
      });
      yield* jobs.cancel(media.id);
      yield* Fiber.interrupt(worker);
    }),
  );
});

it("rejects entries that clash with each other and removes entries", async ({ signal }) => {
  await withRecordings(signal, (database, directory, tools) =>
    Effect.gen(function* () {
      const dictionary = createDictionary(database, completing(database, directory, tools));
      const claude = yield* dictionary.save(null, {
        draft: draft("Claude Code", { similar: true, alsoReplace: ["cloud code"] }),
        fix: [],
      });
      const rejected = (candidate: DictionaryDraft, id: string | null = null) =>
        Effect.map(Effect.flip(dictionary.save(id, { draft: candidate, fix: [] })), (error) => [
          error.reason,
          error.message,
        ]);
      expect(yield* rejected(draft("claude  CODE"))).toEqual([
        "invalid",
        "“Claude Code” is already in the dictionary.",
      ]);
      expect(yield* rejected(draft("Codex", { alsoReplace: ["Cloud Code"] }))).toEqual([
        "invalid",
        "“Cloud Code” already becomes Claude Code.",
      ]);
      expect(yield* rejected(draft("Movo", { similar: true }))).toEqual([
        "invalid",
        "Similar spellings need a word of at least 5 letters. List what the model hears under Also replace.",
      ]);
      expect(yield* rejected(draft("Codex", { alsoReplace: ["codex"] }))).toEqual([
        "invalid",
        "“codex” is the spelling itself. Remove it from Also replace.",
      ]);
      expect(yield* rejected(draft("Codex", { alsoReplace: ["kodex", "Kodex"] }))).toEqual([
        "invalid",
        "“Kodex” is listed twice under Also replace.",
      ]);
      expect(yield* rejected(draft("Codex", { neverChange: ["codex"] }))).toEqual([
        "invalid",
        "“codex” is the spelling itself, so it can't be an exception.",
      ]);

      const renamed = yield* dictionary.save(claude.entry.id, {
        draft: draft("Claude Code", { alsoReplace: ["cloud code", "clod code"] }),
        fix: [],
      });
      expect(renamed.entry).toMatchObject({
        id: claude.entry.id,
        similar: false,
        alsoReplace: ["cloud code", "clod code"],
      });
      expect(yield* dictionary.remove(claude.entry.id)).toEqual([]);
      expect((yield* Effect.flip(dictionary.remove(claude.entry.id))).reason).toBe("notFound");
      expect(
        (yield* Effect.flip(dictionary.save(claude.entry.id, { draft: draft("Codex"), fix: [] })))
          .reason,
      ).toBe("notFound");
    }),
  );
});
