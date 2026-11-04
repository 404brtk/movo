import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DownloadRequest } from "../../shared/contracts/downloads.ts";
import { createDownloads, type Downloads, type DownloadsConfig } from "../downloads/jobs.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError, type MediaErrorReason } from "../media/error.ts";
import { createMediaLibrary } from "../media/library.ts";
import { createMediaTools, type MediaTools } from "../media-tools/tools.ts";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

const errorStatuses = {
  invalid: 400,
  tooLarge: 413,
  unsupported: 415,
  notFound: 404,
  unavailable: 503,
  storage: 500,
} as const satisfies Record<MediaErrorReason, number>;

async function runMedia<A>(operation: Effect.Effect<A, MediaError>, signal?: AbortSignal) {
  const result = await Effect.runPromise(Effect.result(operation), { signal });
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

async function readDownloadUrl(payload: Promise<unknown>) {
  try {
    return Schema.decodeUnknownSync(DownloadRequest)(await payload).url;
  } catch (cause) {
    throw new MediaError("invalid", "Provide a valid JSON object with a video URL.", cause);
  }
}

export function createApp(
  database: AppDatabase,
  config: DownloadsConfig,
  staticDirectory?: string,
  {
    tools = createMediaTools(config),
    downloads = createDownloads(database, config, tools),
  }: { tools?: MediaTools; downloads?: Downloads } = {},
) {
  const library = createMediaLibrary(database, config.dataDirectory, () =>
    tools.resolve("ffprobe"),
  );
  const app = new Hono();
  app.use("*", async (context, next) => {
    const requestUrl = new URL(context.req.url);
    if (!loopbackHosts.has(requestUrl.hostname)) {
      return context.json({ error: "Local requests only" }, 403);
    }
    const origin = context.req.header("origin");
    if (origin && origin !== requestUrl.origin) {
      return context.json({ error: "Origin is not allowed" }, 403);
    }
    return next();
  });

  const downloadBodyLimit = bodyLimit({
    maxSize: 4096,
    onError: (context) =>
      context.json({ error: "Download requests must be 4 KiB or smaller." }, 413),
  });
  app.use("/api/downloads", downloadBodyLimit);
  app.use("/api/downloads/*", downloadBodyLimit);

  const api = new Hono()
    .get("/health", (context) => {
      database.get(sql`select 1`);
      return context.json({ status: "ok" } as const);
    })
    .get("/media-tools", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(tools.status()));
    })
    .post("/media-tools/install", async (context) =>
      context.json(await runMedia(tools.install()), 202),
    )
    .get("/downloads", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(downloads.list()));
    })
    .post("/downloads/preview", async (context) =>
      context.json(
        await runMedia(
          downloads.preview(await readDownloadUrl(context.req.json())),
          context.req.raw.signal,
        ),
      ),
    )
    .post("/downloads", async (context) =>
      context.json(
        await runMedia(downloads.enqueue(await readDownloadUrl(context.req.json()))),
        202,
      ),
    )
    .get("/downloads/:id", async (context) =>
      context.json(await runMedia(downloads.get(context.req.param("id")))),
    )
    .post("/downloads/:id/cancel", async (context) =>
      context.json(await runMedia(downloads.cancel(context.req.param("id")))),
    )
    .post("/downloads/:id/retry", async (context) =>
      context.json(await runMedia(downloads.retry(context.req.param("id"))), 202),
    )
    .get("/media", async (context) => context.json(await runMedia(library.list())))
    .get("/media/:id", async (context) =>
      context.json(await runMedia(library.get(context.req.param("id")))),
    )
    .post("/media", async (context) => {
      let originalName: string;
      try {
        originalName = decodeURIComponent(context.req.header("x-file-name") ?? "");
      } catch (cause) {
        throw new MediaError("invalid", "The filename is invalid.", cause);
      }
      const length = context.req.header("content-length");
      const item = await runMedia(
        library.import(
          context.req.raw.body,
          originalName,
          length === undefined ? undefined : Number(length),
        ),
      );
      return context.json(item, 201);
    })
    .on(["GET", "HEAD"], "/media/:id/file", async (context, next) => {
      const { item, path } = await runMedia(library.file(context.req.param("id")));
      const response = await serveStatic({
        path,
        onNotFound: () => {
          throw new MediaError("notFound", "The stored media copy is missing.");
        },
      })(context, next);
      if (response) {
        response.headers.set("Content-Type", item.contentType);
        response.headers.set("Accept-Ranges", "bytes");
        response.headers.set("Cache-Control", "private, no-store");
        response.headers.set("X-Content-Type-Options", "nosniff");
      }
      return response;
    });
  const routes = app.route("/api", api);
  app.all("/api/*", (context) => context.json({ error: "Not found" }, 404));

  if (staticDirectory) {
    app.use("*", serveStatic({ root: staticDirectory }));
    app.get("*", serveStatic({ path: `${staticDirectory}/index.html` }));
  }
  app.onError((error, context) => {
    if (error instanceof MediaError) {
      if (error.reason === "storage") console.error(error);
      return context.json({ error: error.message }, errorStatuses[error.reason]);
    }
    console.error(error);
    return context.json({ error: "Local service error" }, 500);
  });
  app.notFound((context) => context.json({ error: "Not found" }, 404));
  return routes;
}

export type AppType = ReturnType<typeof createApp>;
