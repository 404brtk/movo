import { existsSync } from "node:fs";
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
import { acquireDataDirectory } from "./instance.ts";
import { createTranscriptions } from "./transcriptions/jobs.ts";
import { createTranscriptionEngine } from "./transcriptions/engine.ts";
import { createMediaLibrary } from "./media/library.ts";

const program = Effect.gen(function* () {
  const config = yield* Effect.try(() => readServerConfig(process.env));
  yield* acquireDataDirectory(config.dataDirectory);
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
  yield* createMediaLibrary(database, config.dataDirectory, () =>
    tools.resolve("ffprobe"),
  ).recoverDeletions();
  const downloads = createDownloads(database, config, tools);
  const models = yield* Effect.acquireRelease(
    Effect.sync(() => createModels()),
    (manager) => manager.close(),
  );
  const transcriptions = createTranscriptions(
    database,
    config,
    tools,
    createTranscriptionEngine(tools, models),
  );
  const downloadWorker = yield* downloads.start();
  const transcriptionWorker = yield* transcriptions.start();
  const app = createApp(database, config, staticDirectory, {
    tools,
    downloads,
    models,
    transcriptions,
  });
  yield* Effect.acquireRelease(
    Effect.tryPromise(
      () =>
        new Promise<ReturnType<typeof serve>>((resolveServer, rejectServer) => {
          const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port });
          server.once("error", rejectServer);
          server.once("listening", () => {
            server.off("error", rejectServer);
            resolveServer(server);
          });
        }),
    ),
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
  return yield* Effect.all([Fiber.join(downloadWorker), Fiber.join(transcriptionWorker)], {
    concurrency: "unbounded",
  });
});

NodeRuntime.runMain(Effect.scoped(program));
