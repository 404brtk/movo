import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import { expect, it } from "vitest";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import { openLegacyDatabase } from "../../../helpers/legacy-database.ts";

it("fails transcripts saved without word timestamps, keeps recordings and cleans their temporary files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "movo-transcript-migration-"));
  const path = join(directory, "app.sqlite");
  const completed = "11111111-1111-4111-8111-111111111111";
  const replacing = "22222222-2222-4222-8222-222222222222";
  const failed = "33333333-3333-4333-8333-333333333333";
  const passageTranscript = JSON.stringify({
    language: null,
    segments: [{ startMs: 0, endMs: 1000, text: "Saved passage." }],
  });
  try {
    const legacy = openLegacyDatabase(directory, path, 7);
    try {
      const insertMedia = legacy.prepare(
        "insert into media_items (id, title, original_name, kind, content_type, byte_size, duration_seconds, imported_at) values (?, ?, 'original.wav', 'audio', 'audio/wav', 100, 2, 1)",
      );
      insertMedia.run(completed, "Completed");
      insertMedia.run(replacing, "Replacing");
      insertMedia.run(failed, "Failed");
      const insertJob = legacy.prepare(
        "insert into transcription_jobs (media_id, model_id, status, phase, transcript, device, error, cleanup_error, created_at, updated_at) values (?, 'parakeet-ultra-q8', ?, ?, ?, ?, ?, ?, 1, 1)",
      );
      insertJob.run(
        completed,
        "completed",
        "finished",
        passageTranscript,
        JSON.stringify({ backend: "cpu", name: "Test CPU" }),
        null,
        "Could not remove temporary transcription files.",
      );
      insertJob.run(replacing, "queued", "queued", passageTranscript, null, null, null);
      insertJob.run(failed, "failed", "finished", null, null, "The engine stopped.", null);
    } finally {
      legacy.close();
    }
    for (const id of [completed, replacing]) {
      mkdirSync(join(directory, "transcriptions", id), { recursive: true });
      writeFileSync(join(directory, "transcriptions", id, "audio.f32"), "prepared audio");
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
          for (const id of [completed, replacing])
            expect(yield* transcriptions.get(id)).toMatchObject({
              status: "failed",
              phase: "finished",
              transcript: null,
              device: null,
              error:
                "This transcript was saved in an earlier format. Retry to transcribe the recording again.",
            });
          expect(yield* transcriptions.get(failed)).toMatchObject({
            status: "failed",
            transcript: null,
            error: "The engine stopped.",
          });
          const worker = yield* transcriptions.start();
          for (const id of [completed, replacing]) {
            expect(existsSync(join(directory, "transcriptions", id))).toBe(false);
            expect(yield* transcriptions.get(id)).toMatchObject({ cleanupError: null });
          }
          yield* Fiber.interrupt(worker);
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          expect((yield* library.list()).map((item) => item.title).toSorted()).toEqual([
            "Completed",
            "Failed",
            "Replacing",
          ]);
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
