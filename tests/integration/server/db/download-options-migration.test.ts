import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createDownloads } from "../../../../src/server/downloads/jobs.ts";
import { createMediaDownloader } from "../../../../src/server/downloads/ytdlp.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { openLegacyDatabase } from "../../../helpers/legacy-database.ts";

it("preserves legacy jobs and media while allowing new variants of their URL", async () => {
  const directory = mkdtempSync(join(tmpdir(), "movo-download-migration-"));
  const path = join(directory, "app.sqlite");
  const id = "11111111-1111-4111-8111-111111111111";
  const queuedId = "22222222-2222-4222-8222-222222222222";
  const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  try {
    const legacy = openLegacyDatabase(directory, path, 4);
    try {
      legacy
        .prepare(
          "insert into media_items (id, title, original_name, kind, content_type, byte_size, duration_seconds, imported_at) values (?, 'Saved media', 'original.wav', 'audio', 'audio/wav', 100, 2, 1)",
        )
        .run(id);
      legacy
        .prepare(
          "insert into download_jobs (id, url, title, status, phase, media_id, downloaded_bytes, cleanup_error, created_at, updated_at) values (?, ?, 'Saved media', 'completed', 'finished', ?, 100, 'Previous cleanup warning', 1, 1)",
        )
        .run(id, url, id);
      legacy
        .prepare(
          "insert into download_jobs (id, url, status, phase, created_at, updated_at) values (?, 'https://www.youtube.com/watch?v=bbbbbbbbbbb', 'queued', 'queued', 2, 2)",
        )
        .run(queuedId);
    } finally {
      legacy.close();
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(path);
            const tools = createMediaTools({ dataDirectory: directory });
            const jobs = createDownloads(
              database,
              { dataDirectory: directory },
              tools,
              createMediaDownloader(() => Effect.succeed("yt-dlp"), tools),
            );
            expect(yield* jobs.get(id)).toMatchObject({
              id,
              url,
              preset: "video-1080p",
              transcribe: false,
              status: "completed",
              mediaId: id,
              title: "Saved media",
              downloadedBytes: 100,
              totalBytes: null,
              cleanupError: "Previous cleanup warning",
            });
            expect(yield* jobs.get(queuedId)).toMatchObject({
              preset: "video-1080p",
              status: "queued",
            });
            expect((yield* jobs.enqueue(url)).id).toBe(id);
            expect((yield* jobs.list()).find((job) => job.preset === "audio")?.transcribe).toBe(
              attempt === 0 ? undefined : true,
            );
            const audio = yield* jobs.enqueue(url, "audio", true);
            expect(audio.id).not.toBe(id);
            expect(audio.preset).toBe("audio");
            expect(yield* jobs.list()).toHaveLength(3);
            expect(database.$client.pragma("foreign_key_check")).toEqual([]);
          }),
        ),
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
