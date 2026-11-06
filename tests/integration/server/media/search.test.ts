import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Effect, type Scope } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { mediaItems } from "../../../../src/server/media/media.schema.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import type { MediaItem } from "../../../../src/shared/contracts/media.ts";
import type { Transcript } from "../../../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
const video = readFileSync(new URL("../../../fixtures/sample.webm", import.meta.url));

interface SearchFixture {
  database: AppDatabase;
  library: ReturnType<typeof createMediaLibrary>;
  meeting: MediaItem;
  review: MediaItem;
  transcribe: (media: MediaItem, words: Transcript["words"]) => Effect.Effect<void>;
}

async function withLibrary(
  signal: AbortSignal,
  test: (fixture: SearchFixture) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-search-"));
  const running = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* openDatabase(join(directory, "app.sqlite"));
        const tools = createMediaTools({ dataDirectory: directory });
        const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
        let nextTranscript: Transcript = { language: null, words: [] };
        const transcriptions = createTranscriptions(database, { dataDirectory: directory }, tools, {
          check: () => Effect.void,
          transcribe: () => Effect.sync(() => nextTranscript),
        });
        yield* transcriptions.start();
        const meeting = yield* library.import(new Response(audio).body, "Łódź meeting.wav");
        const review = yield* library.import(new Response(video).body, "Budget review.webm");
        database
          .update(mediaItems)
          .set({ importedAt: 1000 })
          .where(eq(mediaItems.id, meeting.id))
          .run();
        database
          .update(mediaItems)
          .set({ importedAt: 2000 })
          .where(eq(mediaItems.id, review.id))
          .run();
        yield* test({
          database,
          library,
          meeting: { ...meeting, importedAt: 1000 },
          review: { ...review, importedAt: 2000 },
          transcribe: (media, words) =>
            Effect.gen(function* () {
              nextTranscript = { language: "pl", words };
              const existing = yield* transcriptions.get(media.id);
              yield* existing ? transcriptions.retry(media.id) : transcriptions.enqueue(media.id);
              yield* Effect.promise(async () => {
                await expect
                  .poll(
                    async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status,
                    { timeout: 10000 },
                  )
                  .toBe("completed");
              });
            }).pipe(Effect.orDie),
        });
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

const ids = (items: readonly MediaItem[]) => items.map((item) => item.id);

it("finds titles and transcript passages regardless of case, diacritics and word endings", async ({
  signal,
}) => {
  await withLibrary(signal, ({ library, meeting, review, transcribe }) =>
    Effect.gen(function* () {
      yield* transcribe(review, [
        ...timedWords(0, 900, "Źródło budżetu jest jasne."),
        ...timedWords(1000, 1900, "Plan na jutro."),
      ]);
      expect(yield* library.list({ q: "LODZ" })).toEqual([
        { ...meeting, match: { title: [{ start: 0, end: 4 }], passages: [], passageCount: 0 } },
      ]);
      expect(yield* library.list({ q: "zrodl budzet" })).toEqual([
        {
          ...review,
          match: {
            title: [],
            passages: [
              {
                startMs: 0,
                text: "Źródło budżetu jest jasne.",
                ranges: [
                  { start: 0, end: 6 },
                  { start: 7, end: 14 },
                ],
              },
            ],
            passageCount: 1,
          },
        },
      ]);
      expect(ids(yield* library.list({ q: "budget jutro" }))).toEqual([review.id]);
      expect(yield* library.list({ q: "lodz jutro" })).toEqual([]);
      expect(yield* library.list({ q: "jutro", kind: "audio" })).toEqual([]);
      expect(yield* library.list({ q: '"OR NOT title:(' })).toEqual([]);
      expect(yield* library.list({ q: " ?! " })).toEqual([review, meeting]);
    }),
  );
});

it("filters by type and transcript, ranks title matches first and applies the chosen order", async ({
  signal,
}) => {
  await withLibrary(signal, ({ library, meeting, review, transcribe }) =>
    Effect.gen(function* () {
      yield* transcribe(meeting, timedWords(0, 1500, "The budget meeting starts now."));
      expect(yield* library.list({ kind: "audio" })).toEqual([meeting]);
      expect(yield* library.list({ kind: "video" })).toEqual([review]);
      expect(yield* library.list({ transcript: "available" })).toEqual([meeting]);
      expect(yield* library.list({ transcript: "missing" })).toEqual([review]);
      expect(ids(yield* library.list({ q: "budget" }))).toEqual([review.id, meeting.id]);
      expect(ids(yield* library.list({ q: "budget", kind: "audio" }))).toEqual([meeting.id]);
      expect(ids(yield* library.list({ q: "budget", sort: "oldest" }))).toEqual([
        meeting.id,
        review.id,
      ]);
      expect(ids(yield* library.list({ sort: "relevance" }))).toEqual([review.id, meeting.id]);
      expect(ids(yield* library.list({ sort: "title" }))).toEqual([review.id, meeting.id]);
    }),
  );
});

it("shows the first matching passages and counts all of them", async ({ signal }) => {
  await withLibrary(signal, ({ library, meeting, transcribe }) =>
    Effect.gen(function* () {
      yield* transcribe(
        meeting,
        Array.from({ length: 5 }, (_, index) =>
          timedWords(index * 400, index * 400 + 300, `Plan ${index}.`),
        ).flat(),
      );
      const [result] = yield* library.list({ q: "plan" });
      expect(result?.match?.passageCount).toBe(5);
      expect(result?.match?.passages.map((passage) => passage.startMs)).toEqual([0, 400, 800]);
    }),
  );
});

it("keeps search results in step with renames, replacement transcripts and deletion", async ({
  signal,
}) => {
  await withLibrary(signal, ({ database, library, meeting, review, transcribe }) =>
    Effect.gen(function* () {
      yield* transcribe(review, timedWords(0, 900, "Pierwsza wersja."));
      yield* library.rename(meeting.id, "Kraków notes");
      expect(yield* library.list({ q: "lodz" })).toEqual([]);
      expect(ids(yield* library.list({ q: "krakow" }))).toEqual([meeting.id]);
      yield* transcribe(review, timedWords(0, 900, "Druga wersja."));
      expect(yield* library.list({ q: "pierwsza" })).toEqual([]);
      expect(ids(yield* library.list({ q: "druga" }))).toEqual([review.id]);
      yield* library.remove(review.id);
      expect(yield* library.list({ q: "druga" })).toEqual([]);
      expect(database.all(sql`select media_id as id from media_search`)).toEqual([
        { id: meeting.id },
      ]);
    }),
  );
});
