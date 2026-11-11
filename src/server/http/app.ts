import { serveStatic } from "@hono/node-server/serve-static";
import { sValidator } from "@hono/standard-validator";
import { sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import {
  ApprovalDecision,
  ChatListQuery,
  ChatQuestion,
  ConnectRequest,
  ModelChoice,
  NewChat,
  ScopeChange,
} from "../../shared/contracts/ask.ts";
import { DownloadPreviewRequest, DownloadRequest } from "../../shared/contracts/downloads.ts";
import { LibraryQuery, maxSearchLength } from "../../shared/contracts/library.ts";
import { ImportMediaQuery, RenameMediaRequest } from "../../shared/contracts/media.ts";
import {
  defaultHistoryPage,
  maxHistoryPage,
  maxSpeakerNameCharacters,
  maxWordCharacters,
  PassageEdit,
  SpeakerAssignment,
  SpeakerMerge,
  SpeakerRename,
  TranscriptExportFormat,
  TranscriptHistoryQuery,
  TranscriptReplace,
  TranscriptRestore,
} from "../../shared/contracts/transcriptions.ts";
import { exportTranscript } from "../../shared/transcript-export.ts";
import {
  createDownloads,
  requestDownload,
  type Downloads,
  type DownloadsConfig,
} from "../downloads/jobs.ts";
import { createMediaDownloader } from "../downloads/ytdlp.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError, type MediaErrorReason } from "../media/error.ts";
import { createMediaLibrary } from "../media/library.ts";
import { createMediaTools, type MediaTools } from "../media-tools/tools.ts";
import { createYtdlp, type Ytdlp } from "../media-tools/ytdlp.ts";
import { createModels, type Models } from "../models/models.ts";
import { createTranscriptions, type Transcriptions } from "../transcriptions/jobs.ts";
import { createTranscriptionEngine } from "../transcriptions/engine.ts";
import type { McpHandler } from "../mcp/server.ts";
import { createAsk, type Ask, type LiveAnswerEvent } from "../ask/ask.ts";
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

async function readJson<S extends Schema.ConstraintDecoder<unknown>>(
  payload: Promise<unknown>,
  schema: S,
  message: string,
) {
  try {
    return Schema.decodeUnknownSync(schema)(await payload);
  } catch (cause) {
    throw new MediaError("invalid", message, cause);
  }
}

const readDownloadRequest = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: Promise<unknown>,
) =>
  readJson(
    payload,
    schema,
    "Provide a valid JSON object with at least one video URL and supported download options.",
  );

const askLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (context) => context.json({ error: "Ask requests must be 64 KiB or smaller." }, 413),
});

const modelChoiceMessage = "Choose a model from a connected service.";

const transcriptChangeLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (context) =>
    context.json({ error: "Transcript changes must be 64 KiB or smaller." }, 413),
});

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
    mcp,
    ask: askService,
  }: {
    tools?: MediaTools;
    ytdlp?: Ytdlp;
    downloads?: Downloads;
    models?: Models;
    transcriptions?: Transcriptions;
    mcp?: Pick<McpHandler, "handler">;
    ask?: Ask;
  } = {},
) {
  const library = createMediaLibrary(database, config.dataDirectory, () =>
    tools.resolve("ffprobe"),
  );
  const ask = askService ?? createAsk(database, { library, downloads, transcriptions });
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
    maxSize: 1024 * 1024,
    onError: (context) =>
      context.json({ error: "Download requests must be 1 MiB or smaller." }, 413),
  });
  app.use("/api/downloads", downloadBodyLimit);
  app.use("/api/downloads/*", downloadBodyLimit);
  app.use("/api/ask/*", askLimit);
  if (mcp)
    app.all(
      "/mcp",
      bodyLimit({
        maxSize: 64 * 1024,
        onError: (context) =>
          context.json({ error: "MCP requests must be 64 KiB or smaller." }, 413),
      }),
      (context) => mcp.handler(context.req.raw),
    );

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
          downloads.preview(
            (await readDownloadRequest(DownloadPreviewRequest, context.req.json())).url,
          ),
          context.req.raw.signal,
        ),
      ),
    )
    .post("/downloads", async (context) =>
      context.json(
        await runMedia(
          requestDownload(
            downloads,
            transcriptions,
            await readDownloadRequest(DownloadRequest, context.req.json()),
          ),
        ),
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
    .get(
      "/media",
      sValidator("query", Schema.toStandardSchemaV1(LibraryQuery), (result) => {
        if (!result.success)
          throw new MediaError(
            "invalid",
            `Use a search of up to ${maxSearchLength} characters and supported library filters.`,
          );
      }),
      async (context) => context.json(await runMedia(library.browse(context.req.valid("query")))),
    )
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
        const request = await readJson(
          context.req.json(),
          RenameMediaRequest,
          "Provide a JSON object with a title of 1–512 characters without control characters.",
        );
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
    .get(
      "/media/:id/transcription/changes",
      sValidator("query", Schema.toStandardSchemaV1(TranscriptHistoryQuery), (result) => {
        if (!result.success)
          throw new MediaError(
            "invalid",
            `Request between 1 and ${maxHistoryPage} changes with a non-negative offset.`,
          );
      }),
      async (context) => {
        const { limit = defaultHistoryPage, offset = 0 } = context.req.valid("query");
        context.header("Cache-Control", "no-store");
        return context.json(
          await runMedia(transcriptions.history(context.req.param("id"), { limit, offset })),
        );
      },
    )
    .post("/media/:id/transcription/edit", transcriptChangeLimit, async (context) => {
      const request = await readJson(
        context.req.json(),
        PassageEdit,
        `Provide the transcript revision, a word range and its new text. Words can have at most ${maxWordCharacters} characters.`,
      );
      return context.json(
        await runMedia(transcriptions.edit(context.req.param("id"), request, "app")),
      );
    })
    .post("/media/:id/transcription/replace", transcriptChangeLimit, async (context) => {
      const request = await readJson(
        context.req.json(),
        TranscriptReplace,
        "Provide the transcript revision, the text to find and its replacement.",
      );
      return context.json(
        await runMedia(transcriptions.replace(context.req.param("id"), request, "app")),
      );
    })
    .post("/media/:id/transcription/restore", transcriptChangeLimit, async (context) => {
      const request = await readJson(
        context.req.json(),
        TranscriptRestore,
        "Provide the transcript revision and the version to restore.",
      );
      return context.json(
        await runMedia(transcriptions.restore(context.req.param("id"), request, "app")),
      );
    })
    .post("/media/:id/transcription/speakers/assign", transcriptChangeLimit, async (context) => {
      const request = await readJson(
        context.req.json(),
        SpeakerAssignment,
        "Provide the transcript revision, a word range and the speaker to assign.",
      );
      return context.json(
        await runMedia(transcriptions.assignSpeaker(context.req.param("id"), request, "app")),
      );
    })
    .post("/media/:id/transcription/speakers/merge", transcriptChangeLimit, async (context) => {
      const request = await readJson(
        context.req.json(),
        SpeakerMerge,
        "Provide the transcript revision, the speaker to merge and a different speaker to merge into.",
      );
      return context.json(
        await runMedia(transcriptions.mergeSpeakers(context.req.param("id"), request, "app")),
      );
    })
    .post("/media/:id/transcription/speakers/rename", transcriptChangeLimit, async (context) => {
      const request = await readJson(
        context.req.json(),
        SpeakerRename,
        `Provide the speaker and a name of at most ${maxSpeakerNameCharacters} characters.`,
      );
      return context.json(
        await runMedia(transcriptions.renameSpeaker(context.req.param("id"), request)),
      );
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
    .get("/ask/connections", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(ask.connections()));
    })
    .post("/ask/connections", async (context) => {
      const request = await readJson(
        context.req.json(),
        ConnectRequest,
        "Provide an API key for Anthropic, OpenAI or OpenRouter, or a server address.",
      );
      return context.json(await runMedia(ask.connect(request), context.req.raw.signal), 201);
    })
    .delete("/ask/connections/:id", async (context) =>
      context.json(await runMedia(ask.disconnect(context.req.param("id")))),
    )
    .get("/ask/connections/:id/models", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(
        await runMedia(ask.models(context.req.param("id")), context.req.raw.signal),
      );
    })
    .get("/ask/local", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(ask.localServers(), context.req.raw.signal));
    })
    .get("/ask/default", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(ask.defaultModel()));
    })
    .put("/ask/default", async (context) => {
      const choice = await readJson(context.req.json(), ModelChoice, modelChoiceMessage);
      return context.json(await runMedia(ask.setDefaultModel(choice)));
    })
    .get(
      "/ask/chats",
      sValidator("query", Schema.toStandardSchemaV1(ChatListQuery), (result) => {
        if (!result.success) throw new MediaError("invalid", "Use a valid recording ID.");
      }),
      async (context) => {
        context.header("Cache-Control", "no-store");
        return context.json(await runMedia(ask.chats(context.req.valid("query").mediaId)));
      },
    )
    .post("/ask/chats", async (context) => {
      const request = await readJson(
        context.req.json(),
        NewChat,
        "Provide a recording ID, or null for a library chat.",
      );
      return context.json(
        await runMedia(ask.createChat(request.mediaId, request.scope ?? null)),
        201,
      );
    })
    .get("/ask/chats/:id", async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(await runMedia(ask.chat(context.req.param("id"))));
    })
    .delete("/ask/chats/:id", async (context) => {
      await runMedia(ask.deleteChat(context.req.param("id")));
      return context.body(null, 204);
    })
    .put("/ask/chats/:id/model", async (context) => {
      const choice = await readJson(context.req.json(), ModelChoice, modelChoiceMessage);
      return context.json(await runMedia(ask.setChatModel(context.req.param("id"), choice)));
    })
    .post("/ask/chats/:id/messages", async (context) => {
      const request = await readJson(
        context.req.json(),
        ChatQuestion,
        "Write a question of up to 8,000 characters.",
      );
      return context.json(
        await runMedia(ask.ask(context.req.param("id"), request.text, request.passage ?? null)),
        202,
      );
    })
    .put("/ask/chats/:id/scope", async (context) => {
      const request = await readJson(
        context.req.json(),
        ScopeChange,
        "Choose audio, video or up to 200 recordings, or null for the whole library.",
      );
      return context.json(await runMedia(ask.setScope(context.req.param("id"), request.scope)));
    })
    .post("/ask/chats/:id/stop", async (context) =>
      context.json(await runMedia(ask.stop(context.req.param("id")))),
    )
    .post("/ask/chats/:id/approval", async (context) => {
      const decision = await readJson(
        context.req.json(),
        ApprovalDecision,
        "Provide the approval ID and whether the change is approved.",
      );
      return context.json(await runMedia(ask.decide(context.req.param("id"), decision)), 202);
    })
    .get("/ask/chats/:id/live", (context) => {
      const current = ask.liveAnswer(context.req.param("id"));
      context.header("Cache-Control", "no-store");
      return streamSSE(context, async (stream) => {
        if (!current) {
          await stream.writeSSE({ event: "end", data: "" });
          return;
        }
        await new Promise<void>((resolve) => {
          const send = (event: LiveAnswerEvent) => {
            const written = stream.writeSSE({
              event: event.type,
              data:
                event.type === "delta"
                  ? JSON.stringify(event.text)
                  : event.type === "activity"
                    ? JSON.stringify(event.activity)
                    : "",
            });
            if (event.type === "end") void written.finally(finish);
          };
          const finish = () => {
            current.listeners.delete(send);
            resolve();
          };
          current.listeners.add(send);
          stream.onAbort(finish);
          void stream.writeSSE({
            event: "snapshot",
            data: JSON.stringify({ text: current.text, activity: current.activity }),
          });
        });
      });
    })
    .post(
      "/media",
      sValidator("query", Schema.toStandardSchemaV1(ImportMediaQuery), (result) => {
        if (!result.success)
          throw new MediaError("invalid", "Choose whether to transcribe after importing.");
      }),
      async (context) => {
        let originalName: string;
        try {
          originalName = decodeURIComponent(context.req.header("x-file-name") ?? "");
        } catch (cause) {
          throw new MediaError("invalid", "The filename is invalid.", cause);
        }
        const length = context.req.header("content-length");
        const transcribe = context.req.valid("query").transcribe === "true";
        const item = await runMedia(
          Effect.gen(function* () {
            if (transcribe) yield* transcriptions.check();
            return yield* library.import(
              context.req.raw.body,
              originalName,
              length === undefined ? undefined : Number(length),
              transcribe,
            );
          }),
          context.req.raw.signal,
        );
        return context.json(item, 201);
      },
    )
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
