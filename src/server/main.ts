import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { serve } from "@hono/node-server";
import { Effect } from "effect";
import { readServerConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { createApp } from "./http/app.ts";

const program = Effect.gen(function* () {
  const config = yield* Effect.try(() => readServerConfig(process.env));
  yield* Effect.try(() => mkdirSync(config.dataDirectory, { recursive: true }));
  const database = yield* openDatabase(config.databasePath);
  const staticDirectory = process.env.NODE_ENV === "production" ? resolve("dist/web") : undefined;
  if (staticDirectory && !existsSync(resolve(staticDirectory, "index.html"))) {
    return yield* Effect.fail(
      new Error("Build the application before starting the production server"),
    );
  }
  const app = createApp(database, staticDirectory);
  yield* Effect.acquireRelease(
    Effect.sync(() => serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port })),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
            if ("closeAllConnections" in server) {
              server.closeAllConnections();
            }
          }),
      ),
  );
  yield* Effect.log(`Local service listening on http://127.0.0.1:${config.port}`);
  return yield* Effect.never;
});

NodeRuntime.runMain(Effect.scoped(program));
