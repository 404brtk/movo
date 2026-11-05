import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import { expect, it } from "vitest";
import { readServerConfig } from "../../src/server/config.ts";
import { openDatabase } from "../../src/server/db/database.ts";
import { createDownloads } from "../../src/server/downloads/jobs.ts";
import { createMediaLibrary } from "../../src/server/media/library.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";

it.for(["video-1080p", "audio"] as const)(
  "previews and downloads a public YouTube source as %s into the real library",
  async (preset) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-real-youtube-"));
    const config = readServerConfig({ ...process.env, MOVO_DATA_DIR: directory });
    const tools = createMediaTools(config);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(config.databasePath);
            const jobs = createDownloads(database, config, tools);
            const preview = yield* jobs.preview(
              process.env.MOVO_TEST_YOUTUBE_URL ?? "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            );
            expect(preview.title.length).toBeGreaterThan(0);
            const job = yield* jobs.enqueue(preview.url, preset);
            const worker = yield* jobs.start();
            yield* Effect.promise(async () => {
              await expect
                .poll(
                  async () => {
                    const current = await Effect.runPromise(jobs.get(job.id));
                    if (current.status === "failed" || current.status === "interrupted")
                      throw new Error(current.error ?? current.status);
                    return current.status;
                  },
                  { timeout: 9 * 60 * 1000, interval: 500 },
                )
                .toBe("completed");
            });
            const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
            const file = yield* library.file(job.id);
            expect(file.item.title).toBe(preview.title);
            expect(file.item.sourceUrl).toBe(preview.url);
            expect(file.item.kind).toBe(preset === "audio" ? "audio" : "video");
            expect(file.item.durationSeconds).toBeGreaterThan(0);
            expect((yield* Effect.promise(() => stat(file.path))).size).toBe(file.item.byteSize);
            yield* Fiber.interrupt(worker);
            expect(yield* Effect.promise(() => readdir(join(directory, "downloads")))).toEqual([]);
          }),
        ),
      );
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
);
