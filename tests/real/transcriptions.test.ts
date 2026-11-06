import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { getAvailableBackendsAsync } from "transcribe-cpp";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/database.ts";
import { createMediaLibrary } from "../../src/server/media/library.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { createModels } from "../../src/server/models/models.ts";
import { transcriptionModel } from "../../src/server/models/catalog.ts";
import { createTranscriptions } from "../../src/server/transcriptions/jobs.ts";
import { createTranscriptionEngine } from "../../src/server/transcriptions/engine.ts";
import { runCommand } from "../../src/server/process/command.ts";
import {
  maxPassageCharacters,
  maxPassageMs,
  transcriptPassages,
} from "../../src/shared/transcript-passages.ts";

it.for([1, 7])(
  "transcribes real speech repeated %s times and preserves source and shared weights",
  async (repetitions) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-real-transcription-"));
    const models = createModels();
    try {
      const modelPath = await Effect.runPromise(models.resolve(transcriptionModel.id));
      const before = await stat(modelPath);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const tools = createMediaTools(config);
            const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
            const source = fileURLToPath(new URL("../fixtures/speech.wav", import.meta.url));
            const repeated = join(directory, "speech.wav");
            const ffmpeg = yield* tools.resolve("ffmpeg");
            yield* runCommand(
              ffmpeg,
              [
                "-nostdin",
                "-v",
                "error",
                "-n",
                "-stream_loop",
                String(repetitions - 1),
                "-i",
                source,
                "-c:a",
                "pcm_s16le",
                repeated,
              ],
              { timeoutMs: 15000 },
            );
            const audio = readFileSync(repeated);
            const media = yield* library.import(
              new Response(audio).body,
              "speech.wav",
              audio.length,
            );
            const jobs = createTranscriptions(
              database,
              config,
              tools,
              createTranscriptionEngine(tools, models),
            );
            yield* jobs.enqueue(media.id);
            yield* jobs.start();
            yield* Effect.promise(async () => {
              await expect
                .poll(
                  async () => {
                    const status = (await Effect.runPromise(jobs.get(media.id)))?.status;
                    return status !== "queued" && status !== "running";
                  },
                  { timeout: 180000, interval: 200 },
                )
                .toBe(true);
            });
            const job = yield* jobs.get(media.id);
            if (job?.error) throw new Error(job.error);
            expect(job?.status).toBe("completed");
            const accelerated = (yield* Effect.promise(getAvailableBackendsAsync)).some(
              (entry) => entry.deviceType !== "cpu",
            );
            expect(job?.device?.backend === "cpu").toBe(!accelerated);
            const words = job?.transcript?.words ?? [];
            expect(words.length).toBeGreaterThan(0);
            expect(words.at(-1)?.startMs ?? 0).toBeGreaterThanOrEqual(
              repetitions === 1 ? 0 : 25000,
            );
            const text = words
              .map((word) => word.text)
              .join(" ")
              .toLowerCase();
            expect(text).toContain("transcription");
            expect(text).toContain("computer");
            expect(
              words.every(
                (word) =>
                  word.startMs >= 0 &&
                  word.endMs >= word.startMs &&
                  word.endMs <= media.durationSeconds * 1000 + 1000,
              ),
            ).toBe(true);
            const passages = transcriptPassages(words);
            expect(passages.length).toBeGreaterThanOrEqual(2 * repetitions);
            expect(
              passages.every(
                (passage) =>
                  passage.words.length === 1 ||
                  (passage.text.length <= maxPassageCharacters &&
                    passage.endMs - passage.startMs <= maxPassageMs),
              ),
            ).toBe(true);
            const stored = yield* library.file(media.id);
            expect(yield* Effect.promise(() => readFile(stored.path))).toEqual(audio);
          }),
        ),
      );
      const after = await stat(modelPath);
      expect({ size: after.size, mtime: after.mtimeMs }).toEqual({
        size: before.size,
        mtime: before.mtimeMs,
      });
    } finally {
      await Effect.runPromise(models.close());
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
);
