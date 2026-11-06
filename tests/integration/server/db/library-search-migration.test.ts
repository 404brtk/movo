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

it("indexes recordings and transcripts saved before library search existed", async () => {
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
