import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Fiber, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DownloadJobList } from "../../../../src/shared/contracts/downloads.ts";
import { MediaDeletion, MediaItem } from "../../../../src/shared/contracts/media.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createDownloads } from "../../../../src/server/downloads/jobs.ts";
import { createApp } from "../../../../src/server/http/app.ts";
import { createMcpHandler } from "../../../../src/server/mcp/server.ts";
import { TranscriptionSummary } from "../../../../src/server/mcp/tools.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import {
  createTranscriptions,
  type TranscriptionEngine,
} from "../../../../src/server/transcriptions/jobs.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const endpoint = "http://127.0.0.1:4310/mcp";
const fixture = fileURLToPath(new URL("../../../fixtures/tone.wav", import.meta.url));
const words = [
  ...timedWords(0, 500, "First sentence."),
  ...timedWords(600, 1100, "Second sentence."),
  ...timedWords(1200, 1700, "Third sentence."),
];

const DownloadJobs = Schema.Struct({ jobs: DownloadJobList });
const ToolResult = Schema.Struct({
  isError: Schema.Boolean,
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  structuredContent: Schema.optional(Schema.Unknown),
});
const RpcResponse = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
});

type App = ReturnType<typeof createApp>;
let requestId = 0;

function rpc(app: App, method: string, params: Record<string, unknown> = {}, headers = {}) {
  return app.request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "movo-test", version: "1.0.0" },
        },
      },
    }),
  });
}

async function rpcResult(response: Response) {
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(RpcResponse)(await response.json());
}

async function callTool(app: App, name: string, args: Record<string, unknown>) {
  const { result } = await rpcResult(await rpc(app, "tools/call", { name, arguments: args }));
  return Schema.decodeUnknownSync(ToolResult)(result);
}

async function toolSuccess<A>(
  schema: Schema.Decoder<A>,
  app: App,
  name: string,
  args: Record<string, unknown>,
): Promise<A> {
  const result = await callTool(app, name, args);
  expect(result).toMatchObject({ isError: false });
  return Schema.decodeUnknownSync(schema)(result.structuredContent);
}

async function toolError(app: App, name: string, args: Record<string, unknown>) {
  const result = await callTool(app, name, args);
  expect(result.isError).toBe(true);
  return result.content[0]?.text;
}

function withMovo(
  engine: TranscriptionEngine,
  run: (app: App, directory: string) => Promise<void>,
) {
  return async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-mcp-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const tools = createMediaTools(config);
            const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
            const transcriptions = createTranscriptions(database, config, tools, engine);
            const downloads = createDownloads(database, config, tools, {
              preview: (url) => Effect.succeed({ url, title: "A source", durationSeconds: 2 }),
              download: () => Effect.never,
            });
            const mcp = yield* Effect.acquireRelease(
              Effect.sync(() =>
                createMcpHandler({ library, downloads, transcriptions, port: 4310 }),
              ),
              (handler) => Effect.promise(() => handler.dispose()),
            );
            const app = createApp(database, config, undefined, { tools, transcriptions, mcp });
            const worker = yield* transcriptions.start();
            yield* Effect.promise(() => run(app, directory));
            yield* Fiber.interrupt(worker);
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };
}

const readyEngine: TranscriptionEngine = {
  check: () => Effect.void,
  transcribe: () => Effect.succeed({ language: "en", words }),
};
const missingModelEngine: TranscriptionEngine = {
  check: () => Effect.fail(new MediaError("unavailable", "Install the transcription model first.")),
  transcribe: () => Effect.never,
};

describe("MCP endpoint", () => {
  it(
    "serves annotated tools over current and earlier protocol revisions to local clients only",
    withMovo(readyEngine, async (app) => {
      const discovery = await rpcResult(await rpc(app, "server/discover"));
      expect(discovery.result).toMatchObject({
        supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
      });

      const listing = Schema.decodeUnknownSync(
        Schema.Struct({
          tools: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              annotations: Schema.Struct({
                readOnlyHint: Schema.Boolean,
                destructiveHint: Schema.Boolean,
                openWorldHint: Schema.Boolean,
              }),
            }),
          ),
        }),
      )((await rpcResult(await rpc(app, "tools/list"))).result);
      expect(listing.tools.map((tool) => tool.name)).toEqual([
        "search_library",
        "get_recording",
        "read_transcript",
        "list_downloads",
        "get_download",
        "preview_link",
        "download_links",
        "cancel_download",
        "retry_download",
        "import_file",
        "transcribe_recording",
        "cancel_transcription",
        "retry_transcription",
        "edit_transcript",
        "replace_in_transcript",
        "list_transcript_changes",
        "restore_transcript",
        "rename_recording",
        "remove_saved_copy",
        "delete_recording",
      ]);
      const names = (
        predicate: (hints: (typeof listing.tools)[number]["annotations"]) => boolean,
      ) => listing.tools.filter((tool) => predicate(tool.annotations)).map((tool) => tool.name);
      expect(names((hints) => hints.readOnlyHint)).toEqual([
        "search_library",
        "get_recording",
        "read_transcript",
        "list_downloads",
        "get_download",
        "preview_link",
        "list_transcript_changes",
      ]);
      expect(names((hints) => hints.destructiveHint)).toEqual([
        "retry_transcription",
        "remove_saved_copy",
        "delete_recording",
      ]);
      expect(names((hints) => hints.openWorldHint)).toEqual([
        "preview_link",
        "download_links",
        "retry_download",
      ]);

      const initialize = await app.request(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "movo-test", version: "1.0.0" },
          },
        }),
      });
      expect(initialize.status).toBe(200);
      const session = {
        "mcp-session-id": initialize.headers.get("mcp-session-id") ?? "",
        "mcp-protocol-version": "2025-03-26",
      };
      expect(session["mcp-session-id"]).not.toBe("");
      const legacyCall = await app.request(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...session,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method: "tools/call",
          params: { name: "list_downloads", arguments: {} },
        }),
      });
      expect(Schema.decodeUnknownSync(ToolResult)((await rpcResult(legacyCall)).result)).toEqual({
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ jobs: [], total: 0 }) }],
      });

      expect(
        (await rpc(app, "tools/list", {}, { origin: "https://untrusted.example" })).status,
      ).toBe(403);
      expect((await app.request("http://untrusted.example/mcp", { method: "POST" })).status).toBe(
        403,
      );
      const oversized = await app.request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(64 * 1024 + 1),
      });
      expect(oversized.status).toBe(413);
    }),
  );

  it(
    "imports, transcribes, finds, reads, renames and removes a recording through tools",
    withMovo(readyEngine, async (app) => {
      const original = readFileSync(fixture);
      const item = await toolSuccess(MediaItem, app, "import_file", { path: fixture });
      expect(item).toMatchObject({
        title: "tone",
        originalName: "tone.wav",
        byteSize: original.length,
      });
      expect(readFileSync(fixture)).toEqual(original);

      const queued = await toolSuccess(TranscriptionSummary, app, "transcribe_recording", {
        mediaId: item.id,
      });
      expect(queued?.status).toMatch(/queued|running/);
      await expect
        .poll(
          async () =>
            (
              await toolSuccess(
                Schema.Struct({ transcription: TranscriptionSummary }),
                app,
                "get_recording",
                { mediaId: item.id },
              )
            ).transcription,
        )
        .toMatchObject({
          status: "completed",
          transcript: { language: "en", passageCount: 3 },
        });

      const search = await callTool(app, "search_library", { q: "second" });
      expect(search.structuredContent).toMatchObject({
        total: 1,
        items: [{ id: item.id, match: { passages: [{ startMs: 600 }] } }],
      });
      expect((await callTool(app, "search_library", { limit: 1 })).structuredContent).toMatchObject(
        { total: 1 },
      );
      expect(
        (await callTool(app, "read_transcript", { mediaId: item.id, fromMs: 600, maxPassages: 1 }))
          .structuredContent,
      ).toEqual({
        language: "en",
        revision: 0,
        passages: [
          { startMs: 600, endMs: 1100, text: "Second sentence.", firstWord: 2, wordCount: 2 },
        ],
        nextFromMs: 1200,
      });

      const edited = await toolSuccess(TranscriptionSummary, app, "edit_transcript", {
        mediaId: item.id,
        revision: 0,
        firstWord: 2,
        wordCount: 2,
        text: "Second line.",
      });
      expect(edited?.revision).toBe(1);
      expect(
        await toolError(app, "edit_transcript", {
          mediaId: item.id,
          revision: 0,
          firstWord: 0,
          wordCount: 1,
          text: "One",
        }),
      ).toBe("The transcript changed since it was loaded. Reload it and make the change again.");
      const replaced = await toolSuccess(TranscriptionSummary, app, "replace_in_transcript", {
        mediaId: item.id,
        revision: 1,
        find: "sentence",
        replacement: "line",
      });
      expect(replaced?.revision).toBe(2);
      expect(
        (await callTool(app, "list_transcript_changes", { mediaId: item.id })).structuredContent,
      ).toMatchObject({
        total: 2,
        changes: [
          { revision: 2, kind: "replace", source: "mcp", replacementCount: 2 },
          { revision: 1, kind: "edit", source: "mcp", before: "sentence.", after: "line." },
        ],
      });
      expect(
        await toolSuccess(TranscriptionSummary, app, "restore_transcript", {
          mediaId: item.id,
          revision: 2,
          target: 0,
        }),
      ).toMatchObject({ revision: 3 });

      const renamed = await toolSuccess(MediaItem, app, "rename_recording", {
        mediaId: item.id,
        title: "Renamed",
      });
      expect(renamed.title).toBe("Renamed");
      await toolSuccess(MediaDeletion, app, "remove_saved_copy", { mediaId: item.id });
      expect(
        (await callTool(app, "read_transcript", { mediaId: item.id })).structuredContent,
      ).toMatchObject({ passages: [{ text: "First sentence." }, {}, {}], nextFromMs: null });
      expect(await toolError(app, "retry_transcription", { mediaId: item.id })).toBeTruthy();
      await toolSuccess(MediaDeletion, app, "delete_recording", { mediaId: item.id });
      expect(await toolError(app, "get_recording", { mediaId: item.id })).toBe("Media not found.");
    }),
  );

  it(
    "reports rejected requests as tool errors without changing the library",
    withMovo(missingModelEngine, async (app, directory) => {
      expect(await toolError(app, "import_file", { path: "tone.wav" })).toBe(
        "Provide an absolute path to an audio or video file.",
      );
      expect(await toolError(app, "import_file", { path: directory })).toBe(
        "The path must point to an audio or video file.",
      );
      expect(await toolError(app, "import_file", { path: join(directory, "missing.wav") })).toBe(
        "The file does not exist or cannot be read.",
      );
      const notMedia = join(directory, "notes.wav");
      await writeFile(notMedia, "not audio");
      expect(await toolError(app, "import_file", { path: notMedia })).toBeTruthy();
      expect(readFileSync(notMedia, "utf8")).toBe("not audio");
      expect((await callTool(app, "search_library", {})).structuredContent).toMatchObject({
        total: 0,
      });

      const item = await toolSuccess(MediaItem, app, "import_file", { path: fixture });
      expect(await toolError(app, "transcribe_recording", { mediaId: item.id })).toBe(
        "Install the transcription model first.",
      );
      expect(await toolError(app, "read_transcript", { mediaId: item.id })).toBe(
        "Complete the transcription before reading it.",
      );
      expect(
        await toolError(app, "download_links", {
          urls: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
          transcribe: true,
        }),
      ).toBe("Install the transcription model first.");
      expect((await callTool(app, "list_downloads", {})).structuredContent).toEqual({
        jobs: [],
        total: 0,
      });
      const { jobs } = await toolSuccess(DownloadJobs, app, "download_links", {
        urls: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"],
      });
      expect(jobs).toHaveLength(2);
      expect(jobs[1]?.id).toBe(jobs[0]?.id);
      expect(jobs[0]).toMatchObject({ status: "queued", preset: "video-1080p", transcribe: false });
      expect(
        await toolError(app, "download_links", {
          urls: ["https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://example.com/video"],
        }),
      ).toMatch(/^Link 2: /u);
      expect((await callTool(app, "list_downloads", {})).structuredContent).toMatchObject({
        total: 1,
      });

      expect(
        await toolError(app, "get_recording", { mediaId: "00000000-0000-4000-8000-000000000000" }),
      ).toBe("Media not found.");
      expect(await toolError(app, "get_recording", { mediaId: "nope" })).toContain(
        "Expected a UUID v4",
      );
    }),
  );

  it(
    "pages through downloads and recordings beyond the first page",
    withMovo(readyEngine, async (app) => {
      const { jobs: queued } = await toolSuccess(DownloadJobs, app, "download_links", {
        urls: ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map(
          (videoId) => `https://www.youtube.com/watch?v=${videoId}`,
        ),
      });
      const imported = [];
      for (let copy = 0; copy < 3; copy++)
        imported.push(await toolSuccess(MediaItem, app, "import_file", { path: fixture }));

      const DownloadPage = Schema.Struct({
        jobs: Schema.Array(Schema.Struct({ id: Schema.String })),
        total: Schema.Number,
      });
      const RecordingPage = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })),
        total: Schema.Number,
      });
      const downloadPages = [
        await toolSuccess(DownloadPage, app, "list_downloads", { limit: 2 }),
        await toolSuccess(DownloadPage, app, "list_downloads", { limit: 2, offset: 2 }),
      ];
      const recordingPages = [
        await toolSuccess(RecordingPage, app, "search_library", { limit: 2 }),
        await toolSuccess(RecordingPage, app, "search_library", { limit: 2, offset: 2 }),
      ];

      expect(downloadPages.map((page) => [page.jobs.length, page.total])).toEqual([
        [2, 3],
        [1, 3],
      ]);
      expect(downloadPages.flatMap((page) => page.jobs.map((job) => job.id)).toSorted()).toEqual(
        queued.map((job) => job.id).toSorted(),
      );
      expect(recordingPages.map((page) => [page.items.length, page.total])).toEqual([
        [2, 3],
        [1, 3],
      ]);
      expect(
        recordingPages.flatMap((page) => page.items.map((item) => item.id)).toSorted(),
      ).toEqual(imported.map((item) => item.id).toSorted());
      expect(await toolSuccess(DownloadPage, app, "list_downloads", { offset: 3 })).toEqual({
        jobs: [],
        total: 3,
      });
    }),
  );

  it(
    "logs storage failures on the server while returning the readable message",
    withMovo(readyEngine, async (app, directory) => {
      await writeFile(join(directory, "media"), "a file where the media folder belongs");
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await toolError(app, "import_file", { path: fixture })).toBe(
        "Could not access the media library. Check disk space and folder permissions.",
      );
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[0]).toMatchObject({ name: "MediaError", reason: "storage" });
      expect(
        await toolError(app, "get_recording", { mediaId: "00000000-0000-4000-8000-000000000000" }),
      ).toBe("Media not found.");
      expect(logged).toHaveBeenCalledTimes(1);
    }),
  );
});
