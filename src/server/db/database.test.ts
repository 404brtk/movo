import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.ts";

describe("SQLite connection", () => {
  it("persists records, rolls back failed transactions and closes scoped connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "movo-database-"));
    const path = join(directory, "test.sqlite");
    try {
      const client = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(path);
            database.run(sql`create table fixture (name text not null)`);
            database.run(sql`insert into fixture (name) values (${"persisted"})`);
            expect(() =>
              database.transaction((transaction) => {
                transaction.run(sql`insert into fixture (name) values (${"rolled back"})`);
                throw new Error("Abort transaction");
              }),
            ).toThrow("Abort transaction");
            expect(database.all(sql`select name from fixture`)).toEqual([{ name: "persisted" }]);
            expect(database.$client.pragma("foreign_keys", { simple: true })).toBe(1);
            expect(database.$client.pragma("journal_mode", { simple: true })).toBe("wal");
            return database.$client;
          }),
        ),
      );
      expect(client.open).toBe(false);

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(path);
            expect(database.all(sql`select name from fixture`)).toEqual([{ name: "persisted" }]);
          }),
        ),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("surfaces an inaccessible database path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "movo-missing-database-"));
    try {
      await expect(
        Effect.runPromise(
          Effect.scoped(openDatabase(join(directory, "missing", "database.sqlite"))),
        ),
      ).rejects.toThrow(/Could not open SQLite database/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
