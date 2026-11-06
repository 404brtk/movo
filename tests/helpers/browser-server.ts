import { once } from "node:events";
import { serve } from "@hono/node-server";
import { Effect } from "effect";
import type { createApp } from "../../src/server/http/app.ts";

export const serveBrowserApp = (app: ReturnType<typeof createApp>) =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })),
      (instance) =>
        Effect.promise(
          () =>
            new Promise<void>((resolveClose, reject) => {
              instance.close((error) => (error ? reject(error) : resolveClose()));
              if ("closeAllConnections" in instance) instance.closeAllConnections();
            }),
        ),
    );
    yield* Effect.promise(() => once(server, "listening"));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address.");
    return `http://127.0.0.1:${address.port}`;
  });
