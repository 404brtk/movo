import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { serve } from "@hono/node-server";
import { Effect, Fiber } from "effect";
import { readServerConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { createApp } from "./http/app.ts";
import { createMediaTools } from "./media-tools/tools.ts";
import { createDownloads } from "./downloads/jobs.ts";
import { createModels } from "./models/models.ts";

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
  const tools = yield* Effect.acquireRelease(
    Effect.sync(() => createMediaTools(config)),
    (managedTools) => managedTools.close(),
  );
  const downloads = createDownloads(database, config, tools);
  const models = yield* Effect.acquireRelease(
    Effect.sync(() => createModels()),
    (manager) => manager.close(),
  );
  const worker = yield* downloads.start();
  const app = createApp(database, config, staticDirectory, { tools, downloads, models });
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
  return yield* Fiber.join(worker);
});

NodeRuntime.runMain(Effect.scoped(program));
