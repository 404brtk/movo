import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { maxImportBytes } from "../../../../src/shared/contracts/media.ts";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createDownloads } from "../../../../src/server/downloads/jobs.ts";
import { createMediaDownloader } from "../../../../src/server/downloads/ytdlp.ts";
import { downloadJobs } from "../../../../src/server/downloads/downloads.schema.ts";
import { transcriptionJobs } from "../../../../src/server/transcriptions/transcriptions.schema.ts";
import { transcriptionModel } from "../../../../src/server/models/catalog.ts";
import { blockCleanup } from "../../../helpers/block-cleanup.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const wave = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
const body = () => new Response(new Uint8Array(wave)).body;
const probe = process.env.FFPROBE_PATH ?? "ffprobe";
const resolveProbe = () => Effect.succeed(probe);

async function withLibrary(
  run: (
    library: ReturnType<typeof createMediaLibrary>,
    database: AppDatabase,
    directory: string,
  ) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "movo-library-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "test.sqlite"));
          yield* Effect.promise(() =>
            run(createMediaLibrary(database, directory, resolveProbe), database, directory),
          );
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("managed media library", () => {
  it("persists a trimmed Unicode title without changing the file or original name", async () => {
    await withLibrary(async (library, _database, directory) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      const before = await Effect.runPromise(library.file(item.id));
      const renamed = await Effect.runPromise(library.rename(item.id, "  Rozmowa — zażółć 🎙️  "));
      expect(renamed).toEqual({ ...item, title: "Rozmowa — zażółć 🎙️" });
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "test.sqlite"));
            const reopened = createMediaLibrary(database, directory, resolveProbe);
            expect(yield* reopened.get(item.id)).toEqual(renamed);
            expect(yield* reopened.list()).toEqual([renamed]);
            expect((yield* reopened.file(item.id)).path).toBe(before.path);
            expect(readFileSync(before.path)).toEqual(wave);
          }),
        ),
      );
    });
  });

  it.each(["", "  ", "bad\nname", "bad\u0000name", "a".repeat(513)])(
    "rejects invalid title %j",
    async (title) => {
      await withLibrary(async (library) => {
        const item = await Effect.runPromise(library.import(body(), "recording.wav"));
        await expect(Effect.runPromise(library.rename(item.id, title))).rejects.toThrow(
          "Use a title",
        );
        expect(await Effect.runPromise(library.get(item.id))).toEqual(item);
      });
    },
  );

  it("removes only the selected copy, its transcript, download history and temporary files", async () => {
    await withLibrary(async (library, database, directory) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      const other = await Effect.runPromise(library.import(body(), "recording.wav"));
      const original = join(directory, "recording.wav");
      writeFileSync(original, wave);
      database
        .insert(transcriptionJobs)
        .values({
          mediaId: item.id,
          modelId: transcriptionModel.id,
          status: "completed",
          phase: "finished",
          transcript: {
            language: "pl",
            words: [...timedWords(0, 1000, "Saved speech.")],
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      database
        .insert(downloadJobs)
        .values({
          id: item.id,
          mediaId: item.id,
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          status: "completed",
          phase: "finished",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      for (const folder of ["transcriptions", "downloads"]) {
        const path = join(directory, folder, item.id);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "temporary"), "partial bytes");
      }
      const { path } = await Effect.runPromise(library.file(item.id));
      expect(await Effect.runPromise(library.remove(item.id))).toEqual(item);
      expect(await Effect.runPromise(library.list())).toEqual([other]);
      expect(database.select().from(transcriptionJobs).all()).toEqual([]);
      expect(database.select().from(downloadJobs).all()).toEqual([]);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(join(directory, "transcriptions", item.id))).toBe(false);
      expect(existsSync(join(directory, "downloads", item.id))).toBe(false);
      expect(readFileSync(original)).toEqual(wave);
      expect(readFileSync((await Effect.runPromise(library.file(other.id))).path)).toEqual(wave);
      await expect(Effect.runPromise(library.remove(item.id))).rejects.toThrow("Media not found");
      const config = { dataDirectory: directory };
      const tools = createMediaTools(config);
      const requeued = await Effect.runPromise(
        createDownloads(
          database,
          config,
          tools,
          createMediaDownloader(() => Effect.succeed("yt-dlp"), tools),
        ).enqueue("https://www.youtube.com/watch?v=abcdefghijk"),
      );
      expect(requeued.id).not.toBe(item.id);
      expect(requeued.status).toBe("queued");
    });
  });

  it.each(["queued", "running"] as const)(
    "rejects removal during %s transcription",
    async (status) => {
      await withLibrary(async (library, database) => {
        const item = await Effect.runPromise(library.import(body(), "recording.wav"));
        database
          .insert(transcriptionJobs)
          .values({
            mediaId: item.id,
            modelId: transcriptionModel.id,
            status,
            phase: "queued",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          .run();
        await expect(Effect.runPromise(library.remove(item.id))).rejects.toThrow(
          "Cancel the transcription",
        );
        expect(readFileSync((await Effect.runPromise(library.file(item.id))).path)).toEqual(wave);
        expect(database.select().from(transcriptionJobs).get()?.status).toBe(status);
      });
    },
  );

  it("rejects removal while a download is still publishing the recording", async () => {
    await withLibrary(async (library, database) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      database
        .insert(downloadJobs)
        .values({
          id: item.id,
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          status: "running",
          phase: "saving",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      await expect(Effect.runPromise(library.remove(item.id))).rejects.toThrow(
        "Wait for the download",
      );
      expect(await Effect.runPromise(library.get(item.id))).toEqual(item);
    });
  });

  it("keeps saved media and metadata when SQLite rejects deletion", async () => {
    await withLibrary(async (library, database) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      database.run(
        sql`create trigger reject_delete before delete on media_items begin select raise(fail, 'Deletion rejected'); end`,
      );
      await expect(Effect.runPromise(library.remove(item.id))).rejects.toThrow("Could not access");
      expect(await Effect.runPromise(library.get(item.id))).toEqual(item);
      expect(readFileSync((await Effect.runPromise(library.file(item.id))).path)).toEqual(wave);
      database.run(sql`drop trigger reject_delete`);
      await Effect.runPromise(library.remove(item.id));
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("restores the saved copy and related rows when SQLite rejects the commit", async () => {
    await withLibrary(async (library, database) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      database
        .insert(transcriptionJobs)
        .values({
          mediaId: item.id,
          modelId: transcriptionModel.id,
          status: "completed",
          phase: "finished",
          transcript: { language: null, words: [] },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      database.$client.exec(
        "CREATE TABLE commit_guard (media_id TEXT REFERENCES media_items(id) DEFERRABLE INITIALLY DEFERRED)",
      );
      database.$client.prepare("INSERT INTO commit_guard (media_id) VALUES (?)").run(item.id);
      const removed = await Effect.runPromise(Effect.result(library.remove(item.id)));
      expect(removed).toMatchObject({
        _tag: "Failure",
        failure: { cause: { code: "SQLITE_CONSTRAINT_FOREIGNKEY" } },
      });
      expect(await Effect.runPromise(library.get(item.id))).toEqual(item);
      expect(database.select().from(transcriptionJobs).get()?.transcript).toEqual({
        language: null,
        words: [],
      });
      const stored = await Effect.runPromise(library.file(item.id));
      expect(readFileSync(stored.path)).toEqual(wave);
      expect(readdirSync(join(stored.path, ".."))).toEqual([`${item.id}.wav`]);
      database.$client.exec("DROP TABLE commit_guard");
      await Effect.runPromise(library.remove(item.id));
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("recovers pending deletions after reopening SQLite without overwriting existing files", async () => {
    await withLibrary(async (library, _database, directory) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      const { path } = await Effect.runPromise(library.file(item.id));
      renameSync(path, `${path}.deleting`);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "test.sqlite"));
            const reopened = createMediaLibrary(database, directory, resolveProbe);
            yield* reopened.recoverDeletions();
            expect(readFileSync((yield* reopened.file(item.id)).path)).toEqual(wave);
          }),
        ),
      );
      expect(existsSync(`${path}.deleting`)).toBe(false);
      writeFileSync(`${path}.deleting`, wave);
      writeFileSync(path, "A different copy must not be overwritten");
      await expect(Effect.runPromise(library.recoverDeletions())).rejects.toThrow(
        "without overwriting",
      );
      expect(readFileSync(path, "utf8")).toBe("A different copy must not be overwritten");
      expect(readFileSync(`${path}.deleting`)).toEqual(wave);
      rmSync(path);
      await Effect.runPromise(library.recoverDeletions());
      expect(readFileSync(path)).toEqual(wave);
    });
  });

  it("reports committed cleanup failure and removes the pending copy after repair", async () => {
    await withLibrary(async (library, database) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      const { path } = await Effect.runPromise(library.file(item.id));
      const pending = `${path}.deleting`;
      const held = `${path}.held`;
      database.$client.function("block_pending_cleanup", () => {
        renameSync(pending, held);
        mkdirSync(pending);
        return null;
      });
      database.$client.exec(
        "CREATE TRIGGER block_pending_cleanup AFTER DELETE ON media_items BEGIN SELECT block_pending_cleanup(); END",
      );
      const deleted = await Effect.runPromise(library.remove(item.id));
      expect(deleted).toMatchObject({
        id: item.id,
        cleanupError: expect.stringContaining("restart Movo"),
      });
      expect(await Effect.runPromise(library.list())).toEqual([]);
      expect(readFileSync(held)).toEqual(wave);
      expect(existsSync(path)).toBe(false);
      rmSync(pending, { recursive: true });
      renameSync(held, pending);
      await Effect.runPromise(library.recoverDeletions());
      expect(existsSync(pending)).toBe(false);
    });
  });

  it("preserves unrecognized pending files instead of deleting them during recovery", async () => {
    await withLibrary(async (library, _database, directory) => {
      mkdirSync(join(directory, "media"));
      const invalid = join(directory, "media", "original.wav.deleting");
      writeFileSync(invalid, wave);
      await expect(Effect.runPromise(library.recoverDeletions())).rejects.toThrow(
        "manual recovery",
      );
      expect(readFileSync(invalid)).toEqual(wave);
    });
  });

  it("rolls back metadata after a cleanup failure and allows another deletion attempt", async () => {
    await withLibrary(async (library, database, directory) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      database
        .insert(transcriptionJobs)
        .values({
          mediaId: item.id,
          modelId: transcriptionModel.id,
          status: "completed",
          phase: "finished",
          transcript: { language: null, words: [] },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      const temporary = join(directory, "transcriptions", item.id);
      mkdirSync(temporary, { recursive: true });
      const release = await blockCleanup(temporary);
      try {
        await expect(Effect.runPromise(library.remove(item.id))).rejects.toThrow(
          "Could not access",
        );
        expect(await Effect.runPromise(library.get(item.id))).toEqual(item);
        expect(database.select().from(transcriptionJobs).get()?.transcript).toEqual({
          language: null,
          words: [],
        });
        expect(readFileSync((await Effect.runPromise(library.file(item.id))).path)).toEqual(wave);
      } finally {
        await release();
      }
      await Effect.runPromise(library.remove(item.id));
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("allows deleting metadata when its managed copy is already missing", async () => {
    await withLibrary(async (library) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      rmSync((await Effect.runPromise(library.file(item.id))).path);
      await Effect.runPromise(library.remove(item.id));
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("keeps metadata when the managed file cannot be unlinked and permits retry after repair", async () => {
    await withLibrary(async (library) => {
      const item = await Effect.runPromise(library.import(body(), "recording.wav"));
      const { path } = await Effect.runPromise(library.file(item.id));
      rmSync(path);
      mkdirSync(path);
      await expect(Effect.runPromise(library.remove(item.id))).rejects.toThrow("Could not access");
      expect(await Effect.runPromise(library.get(item.id))).toEqual(item);
      rmSync(path, { recursive: true });
      writeFileSync(path, wave);
      await Effect.runPromise(library.remove(item.id));
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("copies local audio, preserves its original and survives reopening the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "movo-library-persistence-"));
    const databasePath = join(directory, "test.sqlite");
    const original = join(directory, "Original recording.wav");
    writeFileSync(original, wave);
    try {
      const imported = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(databasePath);
            return yield* createMediaLibrary(database, directory, resolveProbe).import(
              body(),
              "Próbka mowy.wav",
              wave.length,
            );
          }),
        ),
      );
      expect(imported).toMatchObject({
        title: "Próbka mowy",
        originalName: "Próbka mowy.wav",
        kind: "audio",
        contentType: "audio/wav",
        byteSize: wave.length,
        durationSeconds: 2,
      });
      expect(readFileSync(original)).toEqual(wave);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(databasePath);
            const library = createMediaLibrary(database, directory, resolveProbe);
            expect(yield* library.list()).toEqual([imported]);
            const stored = yield* library.file(imported.id);
            expect(readFileSync(stored.path)).toEqual(wave);
            expect(stored.path).not.toBe(original);
          }),
        ),
      );
      expect(readdirSync(join(directory, "media"))).toEqual([`${imported.id}.wav`]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps separate copies when imported filenames are identical", async () => {
    await withLibrary(async (library) => {
      const first = await Effect.runPromise(library.import(body(), "recording.wav"));
      const second = await Effect.runPromise(library.import(body(), "recording.wav"));
      expect(second.id).not.toBe(first.id);
      expect((await Effect.runPromise(library.list())).map((item) => item.id)).toEqual([
        second.id,
        first.id,
      ]);
    });
  });

  it.each(["../outside.wav", "folder\\outside.wav", " ", "..", ".", "recording\n.wav"])(
    "rejects unsafe filename %j",
    async (name) => {
      await withLibrary(async (library) => {
        await expect(Effect.runPromise(library.import(body(), name))).rejects.toThrow(
          "valid filename",
        );
        expect(await Effect.runPromise(library.list())).toEqual([]);
      });
    },
  );

  it("rejects declared oversize and truncated uploads without importing them", async () => {
    await withLibrary(async (library, _database, directory) => {
      await expect(
        Effect.runPromise(library.import(body(), "too-large.wav", maxImportBytes + 1)),
      ).rejects.toThrow("10 GiB");
      await expect(
        Effect.runPromise(library.import(body(), "truncated.wav", wave.length + 10)),
      ).rejects.toThrow("incomplete");
      expect(await Effect.runPromise(library.list())).toEqual([]);
      expect(readdirSync(join(directory, "media"))).toEqual([]);
    });
  });

  it("removes partial files when upload delivery fails", async () => {
    await withLibrary(async (library, _database, directory) => {
      let pulls = 0;
      const interrupted = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new Uint8Array(wave.subarray(0, 100)));
          else controller.error(new Error("Upload disconnected"));
        },
      });
      await expect(
        Effect.runPromise(library.import(interrupted, "interrupted.wav")),
      ).rejects.toThrow("The upload was interrupted");
      expect(readdirSync(join(directory, "media"))).toEqual([]);
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("rejects non-media and removes its managed partial file", async () => {
    await withLibrary(async (library, _database, directory) => {
      await expect(
        Effect.runPromise(library.import(new Response("not a recording").body, "pretend.wav")),
      ).rejects.toThrow("Could not read");
      expect(readdirSync(join(directory, "media"))).toEqual([]);
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("removes the copied file when SQLite rejects the metadata insert", async () => {
    await withLibrary(async (library, database, directory) => {
      database.run(
        sql`create trigger reject_import before insert on media_items begin select raise(fail, 'Database insert rejected'); end`,
      );
      await expect(Effect.runPromise(library.import(body(), "recording.wav"))).rejects.toThrow(
        "Could not access",
      );
      expect(readdirSync(join(directory, "media"))).toEqual([]);
      expect(await Effect.runPromise(library.list())).toEqual([]);
    });
  });

  it("rejects unavailable FFprobe before reading or storing the upload", async () => {
    await withLibrary(async (_library, database, directory) => {
      const tools = createMediaTools({
        dataDirectory: directory,
        ffprobePath: join(directory, "missing-ffprobe"),
      });
      const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
      let read = false;
      const upload = new ReadableStream<Uint8Array>(
        {
          pull() {
            read = true;
          },
        },
        { highWaterMark: 0 },
      );
      await expect(Effect.runPromise(library.import(upload, "recording.wav"))).rejects.toThrow(
        "FFPROBE_PATH",
      );
      expect(read).toBe(false);
      expect(readdirSync(directory)).not.toContain("media");
    });
  });

  it("surfaces storage failure without removing an existing file", async () => {
    await withLibrary(async (library, _database, directory) => {
      const blockingFile = join(directory, "media");
      writeFileSync(blockingFile, "keep this file");
      await expect(Effect.runPromise(library.import(body(), "recording.wav"))).rejects.toThrow(
        "Could not access",
      );
      expect(readFileSync(blockingFile, "utf8")).toBe("keep this file");
    });
  });

  it("reports a missing managed copy and keeps its metadata", async () => {
    await withLibrary(async (library) => {
      const imported = await Effect.runPromise(library.import(body(), "recording.wav"));
      const stored = await Effect.runPromise(library.file(imported.id));
      rmSync(stored.path);
      await expect(Effect.runPromise(library.file(imported.id))).rejects.toThrow(
        "stored media copy is missing",
      );
      expect(await Effect.runPromise(library.get(imported.id))).toEqual(imported);
    });
  });
});
