import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Effect } from "effect";

export function acquireDataDirectory(directory: string) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") await chmod(directory, 0o700);
        const database = new Database(join(directory, "instance.sqlite"), { timeout: 0 });
        try {
          database.exec("BEGIN EXCLUSIVE");
          return database;
        } catch (cause) {
          database.close();
          if (cause instanceof Database.SqliteError && cause.code === "SQLITE_BUSY")
            throw new Error(
              "Another Movo backend is already using this data directory. Stop it or choose a different MOVO_DATA_DIR.",
              { cause },
            );
          throw cause;
        }
      },
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Could not lock Movo's data directory.", { cause }),
    }),
    (database) => Effect.sync(() => database.close()),
  );
}
