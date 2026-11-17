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

it("keeps recognising recordings downloaded before presets were saved with them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "movo-source-preset-migration-"));
  const path = join(directory, "app.sqlite");
  const id = "11111111-1111-4111-8111-111111111111";
  const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  try {
    const legacy = openLegacyDatabase(directory, path, 14);
    try {
      legacy
        .prepare(
          "insert into media_items (id, title, original_name, kind, content_type, byte_size, duration_seconds, source_url, imported_at) values (?, 'Saved media', 'original.m4a', 'audio', 'audio/mp4', 100, 2, ?, 1)",
        )
        .run(id, url);
      legacy
        .prepare(
          "insert into download_jobs (id, url, preset, title, status, phase, media_id, downloaded_bytes, created_at, updated_at) values (?, ?, 'audio', 'Saved media', 'completed', 'finished', ?, 100, 1, 1)",
        )
        .run(id, url, id);
    } finally {
      legacy.close();
    }
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
          expect(yield* jobs.clear()).toEqual([]);
          expect(yield* jobs.enqueue(url, "audio")).toMatchObject({
            status: "completed",
            mediaId: id,
          });
          expect((yield* jobs.enqueue(url, "video-720p")).status).toBe("queued");
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
