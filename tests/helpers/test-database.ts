import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { openDatabase } from "../../src/server/db/database.ts";

export async function openTestDatabase(directory: string, filename = "app.sqlite") {
  const scope = Scope.makeUnsafe();
  const database = await Effect.runPromise(
    Scope.provide(openDatabase(join(directory, filename)), scope),
  );
  return { database, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
