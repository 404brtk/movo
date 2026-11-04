import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { maxImportBytes } from "../../../../src/shared/contracts/media.ts";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";

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
