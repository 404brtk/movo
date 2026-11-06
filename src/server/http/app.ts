import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DownloadRequest } from "../../shared/contracts/downloads.ts";
import { RenameMediaRequest } from "../../shared/contracts/media.ts";
import { TranscriptExportFormat } from "../../shared/contracts/transcriptions.ts";
import { exportTranscript } from "../../shared/transcript-export.ts";
import { createDownloads, type Downloads, type DownloadsConfig } from "../downloads/jobs.ts";
import { createMediaDownloader } from "../downloads/ytdlp.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError, type MediaErrorReason } from "../media/error.ts";
import { createMediaLibrary } from "../media/library.ts";
import { createMediaTools, type MediaTools } from "../media-tools/tools.ts";
import { createYtdlp, type Ytdlp } from "../media-tools/ytdlp.ts";
import { createModels, type Models } from "../models/models.ts";
import { createTranscriptions, type Transcriptions } from "../transcriptions/jobs.ts";
import { createTranscriptionEngine } from "../transcriptions/engine.ts";
import { attachmentDisposition } from "./attachment.ts";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

const errorStatuses = {
  invalid: 400,
  tooLarge: 413,
  unsupported: 415,
  notFound: 404,
  conflict: 409,
  unavailable: 503,
  storage: 500,
} as const satisfies Record<MediaErrorReason, number>;

async function runMedia<A>(operation: Effect.Effect<A, MediaError>, signal?: AbortSignal) {
  const result = await Effect.runPromise(Effect.result(operation), { signal });
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

async function readDownloadRequest(payload: Promise<unknown>) {
  try {
    return Schema.decodeUnknownSync(DownloadRequest)(await payload);
  } catch (cause) {
    throw new MediaError(
      "invalid",
      "Provide a valid JSON object with a video URL and supported download options.",
      cause,
    );
  }
}

export function createApp(
  database: AppDatabase,
  config: DownloadsConfig,
  staticDirectory?: string,
  {
    tools = createMediaTools(config),
    ytdlp = createYtdlp(config),
    downloads = createDownloads(
      database,
      config,
      tools,
      createMediaDownloader(() => ytdlp.resolve("ytdlp"), tools),
    ),
    models = createModels(),
    transcriptions = createTranscriptions(
      database,
      config,
      tools,
      createTranscriptionEngine(tools, models),
    ),
  }: {
    tools?: MediaTools;
    ytdlp?: Ytdlp;
    downloads?: Downloads;
    models?: Models;
    transcriptions?: Transcriptions;
  } = {},
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
    .get("/ytdlp", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(ytdlp.status()));
    })
    .post("/ytdlp/install", async (context) => context.json(await runMedia(ytdlp.install()), 202))
    .get("/models", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(models.list()));
    })
    .post("/models/:id/install", async (context) =>
      context.json(await runMedia(models.install(context.req.param("id"))), 202),
    )
    .post("/models/:id/cancel", async (context) =>
      context.json(await runMedia(models.cancel(context.req.param("id")))),
    )
    .get("/downloads", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(downloads.list()));
    })
    .post("/downloads/preview", async (context) =>
      context.json(
        await runMedia(
          downloads.preview((await readDownloadRequest(context.req.json())).url),
          context.req.raw.signal,
        ),
      ),
    )
    .post("/downloads", async (context) => {
      const request = await readDownloadRequest(context.req.json());
      return context.json(
        await runMedia(
          Effect.gen(function* () {
            if (request.transcribe) yield* transcriptions.check();
            return yield* downloads.enqueue(request.url, request.preset, request.transcribe);
          }),
        ),
        202,
      );
    })
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
    .patch(
      "/media/:id",
      bodyLimit({
        maxSize: 4096,
        onError: (context) =>
          context.json({ error: "Title requests must be 4 KiB or smaller." }, 413),
      }),
      async (context) => {
        let request: typeof RenameMediaRequest.Type;
        try {
          request = Schema.decodeUnknownSync(RenameMediaRequest)(await context.req.json());
        } catch (cause) {
          throw new MediaError(
            "invalid",
            "Provide a JSON object with a title of 1–512 characters without control characters.",
            cause,
          );
        }
        return context.json(await runMedia(library.rename(context.req.param("id"), request.title)));
      },
    )
    .delete("/media/:id", async (context) =>
      context.json(await runMedia(transcriptions.removeMedia(context.req.param("id")))),
    )
    .get("/media/:id/transcription", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(transcriptions.get(context.req.param("id"))));
    })
    .get("/media/:id/transcription/export/:format", async (context) => {
      let format: TranscriptExportFormat;
      try {
        format = Schema.decodeUnknownSync(TranscriptExportFormat)(context.req.param("format"));
      } catch (cause) {
        throw new MediaError("invalid", "Choose TXT, SRT or VTT for the transcript export.", cause);
      }
      const job = await runMedia(transcriptions.get(context.req.param("id")));
      if (!job?.transcript)
        throw new MediaError("invalid", "Complete the transcription before downloading it.");
      const item = await runMedia(library.get(job.mediaId));
      const contentTypes = {
        txt: "text/plain; charset=utf-8",
        srt: "application/x-subrip; charset=utf-8",
        vtt: "text/vtt; charset=utf-8",
      };
      return new Response(exportTranscript(job.transcript, format), {
        headers: {
          "Content-Type": contentTypes[format],
          "Content-Disposition": attachmentDisposition(`${item.title}.${format}`),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    })
    .post("/media/:id/transcription", async (context) =>
      context.json(await runMedia(transcriptions.enqueue(context.req.param("id"))), 202),
    )
    .post("/media/:id/transcription/cancel", async (context) =>
      context.json(await runMedia(transcriptions.cancel(context.req.param("id")))),
    )
    .post("/media/:id/transcription/retry", async (context) =>
      context.json(await runMedia(transcriptions.retry(context.req.param("id"))), 202),
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
    .delete("/media/:id/file", async (context) =>
      context.json(await runMedia(transcriptions.removeMediaFile(context.req.param("id")))),
    )
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
