import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Effect } from "effect";
import { createServer, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import viteConfig from "../../../vite.config.ts";
import { openDatabase } from "../db/database.ts";
import { createApp } from "./app.ts";

describe("development API proxy", () => {
  it("accepts same-origin writes through localhost and the loopback IP while rejecting foreign origins", async () => {
    const directory = mkdtempSync(join(tmpdir(), "movo-dev-proxy-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(":memory:");
            yield* Effect.promise(async () => {
              const app = createApp(database, { dataDirectory: directory, ffprobePath: "ffprobe" });
              const backend = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
              let proxy: ViteDevServer | undefined;
              try {
                await once(backend, "listening");
                const backendAddress = backend.address();
                if (!backendAddress || typeof backendAddress === "string")
                  throw new Error("API test server has no TCP address");
                const target = `http://127.0.0.1:${backendAddress.port}`;
                const configuredProxy = viteConfig.server?.proxy?.["/api"];
                if (!configuredProxy) throw new Error("Vite API proxy is not configured");
                proxy = await createServer({
                  configFile: false,
                  root: directory,
                  logLevel: "silent",
                  server: {
                    ...viteConfig.server,
                    port: 0,
                    proxy: {
                      "/api":
                        typeof configuredProxy === "string"
                          ? target
                          : { ...configuredProxy, target },
                    },
                  },
                });
                await proxy.listen();
                const proxyAddress = proxy.httpServer?.address();
                if (!proxyAddress || typeof proxyAddress === "string")
                  throw new Error("Vite test server has no TCP address");
                for (const host of ["localhost", "127.0.0.1"]) {
                  const origin = `http://${host}:${proxyAddress.port}`;
                  const response = await fetch(`${origin}/api/media`, {
                    method: "POST",
                    headers: { origin },
                  });
                  const payload: unknown = await response.json();
                  expect({ origin, status: response.status, payload }).toEqual({
                    origin,
                    status: 400,
                    payload: { error: "Choose an audio or video file with a valid filename." },
                  });
                }
                const forbidden = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/media`, {
                  method: "POST",
                  headers: { origin: "https://untrusted.example" },
                });
                expect(forbidden.status).toBe(403);
                expect(await forbidden.json()).toEqual({ error: "Origin is not allowed" });
              } finally {
                await proxy?.close();
                await new Promise<void>((resolveClose, rejectClose) => {
                  backend.close((error) => (error ? rejectClose(error) : resolveClose()));
                  if ("closeAllConnections" in backend) backend.closeAllConnections();
                });
              }
            });
          }),
        ),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
