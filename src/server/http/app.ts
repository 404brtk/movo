import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDatabase } from "../db/database.ts";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function createApp(database: AppDatabase, staticDirectory?: string) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    const requestUrl = new URL(context.req.url);
    if (!loopbackHosts.has(requestUrl.hostname)) {
      return context.json({ error: "Local requests only" }, 403);
    }
    const origin = context.req.header("origin");
    if (origin && origin !== requestUrl.origin && origin !== "http://127.0.0.1:5173") {
      return context.json({ error: "Origin is not allowed" }, 403);
    }
    return next();
  });

  const api = new Hono().get("/health", (context) => {
    database.get(sql`select 1`);
    return context.json({ status: "ok" } as const);
  });
  const routes = app.route("/api", api);
  app.all("/api/*", (context) => context.json({ error: "Not found" }, 404));

  if (staticDirectory) {
    app.use("*", serveStatic({ root: staticDirectory }));
    app.get("*", serveStatic({ path: `${staticDirectory}/index.html` }));
  }
  app.onError((error, context) => {
    console.error(error);
    return context.json({ error: "Local service error" }, 500);
  });
  app.notFound((context) => context.json({ error: "Not found" }, 404));
  return routes;
}

export type AppType = ReturnType<typeof createApp>;
