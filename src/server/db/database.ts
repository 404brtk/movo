import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Effect } from "effect";

export function openDatabase(path: string) {
  return Effect.acquireRelease(
    Effect.try({
      try: () => {
        const client = new Database(path);
        try {
          client.pragma("journal_mode = WAL");
          client.pragma("foreign_keys = ON");
          return drizzle({ client });
        } catch (error) {
          client.close();
          throw error;
        }
      },
      catch: (cause) => new Error(`Could not open SQLite database: ${path}`, { cause }),
    }),
    (database) => Effect.sync(() => database.$client.close()),
  );
}

export type AppDatabase = Effect.Success<ReturnType<typeof openDatabase>>;
