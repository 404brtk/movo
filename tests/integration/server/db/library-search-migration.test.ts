import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { openLegacyDatabase } from "../../../helpers/legacy-database.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

it("indexes recordings and transcripts saved before library search existed at startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "movo-search-migration-"));
  const path = join(directory, "app.sqlite");
  const transcribed = "11111111-1111-4111-8111-111111111111";
  const untranscribed = "22222222-2222-4222-8222-222222222222";
  try {
    const legacy = openLegacyDatabase(directory, path, 9);
    try {
      const insertMedia = legacy.prepare(
        "insert into media_items (id, title, original_name, kind, content_type, byte_size, duration_seconds, imported_at) values (?, ?, 'original.wav', 'audio', 'audio/wav', 100, 2, ?)",
      );
      insertMedia.run(transcribed, "Wywiad", 1);
      insertMedia.run(untranscribed, "Spotkanie w Łodzi", 2);
      legacy
        .prepare(
          "insert into transcription_jobs (media_id, model_id, status, phase, transcript, created_at, updated_at) values (?, 'parakeet-ultra-q8', 'completed', 'finished', ?, 1, 1)",
        )
        .run(
          transcribed,
          JSON.stringify({
            language: "pl",
            words: [
              ...timedWords(0, 900, "Źródło ŁAD i Øresund."),
              ...timedWords(1000, 1500, "Koniec."),
            ],
          }),
        );
    } finally {
      legacy.close();
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(path);
          const tools = createMediaTools({ dataDirectory: directory });
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          expect(yield* library.list({ q: "wywiad" })).toEqual([]);
          yield* library.syncSearchIndex();
          const [interview] = yield* library.list({ q: "zrodlo lad oresund" });
          expect(interview?.id).toBe(transcribed);
          expect(interview?.match?.passages).toEqual([
            {
              startMs: 0,
              text: "Źródło ŁAD i Øresund.",
              ranges: [
                { start: 0, end: 6 },
                { start: 7, end: 10 },
                { start: 13, end: 20 },
              ],
            },
          ]);
          expect((yield* library.list({ q: "lodzi" })).map((item) => item.id)).toEqual([
            untranscribed,
          ]);
          expect(yield* library.list({ q: "koniec", transcript: "missing" })).toEqual([]);
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rebuilds an index saved before speaker names were searchable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "movo-speaker-search-migration-"));
  const path = join(directory, "app.sqlite");
  const id = "33333333-3333-4333-8333-333333333333";
  try {
    const legacy = openLegacyDatabase(directory, path, 13);
    try {
      legacy
        .prepare(
          "insert into media_items (id, title, original_name, kind, content_type, byte_size, duration_seconds, imported_at) values (?, 'Wywiad', 'original.wav', 'audio', 'audio/wav', 100, 2, 1)",
        )
        .run(id);
      legacy
        .prepare(
          "insert into transcription_jobs (media_id, model_id, status, phase, transcript, created_at, updated_at) values (?, 'parakeet-ultra-q8', 'completed', 'finished', ?, 1, 1)",
        )
        .run(
          id,
          JSON.stringify({
            language: "pl",
            words: timedWords(0, 900, "Dzień dobry.").map((word) => ({ ...word, speaker: 1 })),
            speakers: [{ id: 1, name: "Anna" }],
          }),
        );
      legacy.prepare("insert into search_index (version) values (2)").run();
      legacy
        .prepare(
          "insert into media_search (media_id, title, transcript) values (?, 'wywiad', 'dzien dobry.')",
        )
        .run(id);
      legacy
        .prepare(
          "insert into search_passages (media_id, start_ms, text, search_text) values (?, 0, 'Dzień dobry.', 'dzien dobry.')",
        )
        .run(id);
    } finally {
      legacy.close();
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(path);
          const tools = createMediaTools({ dataDirectory: directory });
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          yield* library.syncSearchIndex();
          const [interview] = yield* library.list({ q: "anna dobry" });
          expect(interview?.match?.passages).toEqual([
            {
              startMs: 0,
              text: "Dzień dobry.",
              ranges: [{ start: 6, end: 11 }],
              speaker: { name: "Anna", ranges: [{ start: 0, end: 4 }] },
            },
          ]);
          yield* library.remove(id);
          expect(yield* library.list({ q: "dobry" })).toEqual([]);
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
