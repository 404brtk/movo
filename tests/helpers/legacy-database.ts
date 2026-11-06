import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function openLegacyDatabase(directory: string, path: string, lastMigration: number) {
  const journal: { entries: { idx: number; tag: string }[] } = JSON.parse(
    readFileSync(resolve("migrations/meta/_journal.json"), "utf8"),
  );
  const entries = journal.entries.filter((entry) => entry.idx <= lastMigration);
  const legacyMigrations = join(directory, "legacy");
  mkdirSync(join(legacyMigrations, "meta"), { recursive: true });
  writeFileSync(
    join(legacyMigrations, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries)
    copyFileSync(
      resolve("migrations", entry.tag + ".sql"),
      join(legacyMigrations, entry.tag + ".sql"),
    );
  const legacy = new Database(path);
  legacy.pragma("foreign_keys = ON");
  migrate(drizzle({ client: legacy }), { migrationsFolder: legacyMigrations });
  return legacy;
}
