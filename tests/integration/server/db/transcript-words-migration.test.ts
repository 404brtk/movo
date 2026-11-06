import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import { openLegacyDatabase } from "../../../helpers/legacy-database.ts";

it("removes transcripts saved without word timestamps and keeps recordings and other attempts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "movo-transcript-migration-"));
  const path = join(directory, "app.sqlite");
  const transcribed = "11111111-1111-4111-8111-111111111111";
  const failed = "22222222-2222-4222-8222-222222222222";
  try {
    const legacy = openLegacyDatabase(directory, path, 7);
    try {
      const insertMedia = legacy.prepare(
        "insert into media_items (id, title, original_name, kind, content_type, byte_size, duration_seconds, imported_at) values (?, ?, 'original.wav', 'audio', 'audio/wav', 100, 2, 1)",
      );
      insertMedia.run(transcribed, "Transcribed");
      insertMedia.run(failed, "Failed");
      legacy
        .prepare(
          "insert into transcription_jobs (media_id, model_id, status, phase, transcript, device, created_at, updated_at) values (?, 'parakeet-ultra-q8', 'completed', 'finished', ?, ?, 1, 1)",
        )
        .run(
          transcribed,
          JSON.stringify({
            language: null,
            segments: [{ startMs: 0, endMs: 1000, text: "Saved passage." }],
          }),
          JSON.stringify({ backend: "cpu", name: "Test CPU" }),
        );
      legacy
        .prepare(
          "insert into transcription_jobs (media_id, model_id, status, phase, error, created_at, updated_at) values (?, 'parakeet-ultra-q8', 'failed', 'finished', 'The engine stopped.', 1, 1)",
        )
        .run(failed);
    } finally {
      legacy.close();
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(path);
          const tools = createMediaTools({ dataDirectory: directory });
          const transcriptions = createTranscriptions(
            database,
            { dataDirectory: directory },
            tools,
            {
              check: () => Effect.void,
              transcribe: () => Effect.never,
            },
          );
          expect(yield* transcriptions.get(transcribed)).toBeNull();
          expect(yield* transcriptions.get(failed)).toMatchObject({
            status: "failed",
            transcript: null,
            error: "The engine stopped.",
          });
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          expect((yield* library.list()).map((item) => item.title).toSorted()).toEqual([
            "Failed",
            "Transcribed",
          ]);
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
