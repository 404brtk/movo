import { Effect, Layer } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter, HttpServer } from "effect/http";
import type {
  TranscriptChangeSource,
  TranscriptionJob,
} from "../../shared/contracts/transcriptions.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { requestDownload, type Downloads } from "../downloads/jobs.ts";
import { MediaError } from "../media/error.ts";
import type { createMediaLibrary } from "../media/library.ts";
import type { Transcriptions } from "../transcriptions/jobs.ts";
import { movoTools } from "./tools.ts";
import { defaultPagePassages, transcriptPage } from "./transcript-page.ts";

export interface McpServices {
  library: ReturnType<typeof createMediaLibrary>;
  downloads: Downloads;
  transcriptions: Transcriptions;
  port: number;
}

const defaultListLimit = 20;

const summarize = (job: TranscriptionJob | null) =>
  job && {
    ...job,
    transcript: job.transcript && {
      language: job.transcript.language,
      passageCount: transcriptPassages(job.transcript.words).length,
    },
  };

const reported = <A>(operation: Effect.Effect<A, MediaError>) =>
  Effect.tapError(operation, (error) =>
    error.reason === "storage" ? Effect.sync(() => console.error(error)) : Effect.void,
  );

export const toolHandlers = (
  { library, downloads, transcriptions }: Omit<McpServices, "port">,
  source: TranscriptChangeSource,
) =>
  ({
    search_library: ({ limit = defaultListLimit, offset = 0, ...query }) =>
      reported(
        library.browse(query).pipe(
          Effect.map(({ items, transcribing }) => ({
            items: items.slice(offset, offset + limit),
            total: items.length,
            transcribing,
          })),
        ),
      ),
    get_recording: ({ mediaId }) =>
      reported(
        Effect.all({
          recording: library.get(mediaId),
          transcription: transcriptions.get(mediaId).pipe(Effect.map(summarize)),
        }),
      ),
    read_transcript: ({ mediaId, fromMs = 0, maxPassages = defaultPagePassages }) =>
      reported(
        Effect.flatMap(transcriptions.get(mediaId), (job) =>
          job?.transcript
            ? Effect.succeed({
                language: job.transcript.language,
                revision: job.revision,
                ...transcriptPage(job.transcript.words, fromMs, maxPassages),
              })
            : Effect.fail(
                new MediaError("invalid", "Complete the transcription before reading it."),
              ),
        ),
      ),
    list_downloads: ({ limit = defaultListLimit, offset = 0 }) =>
      reported(
        downloads.list().pipe(
          Effect.map((jobs) => ({
            jobs: jobs.slice(offset, offset + limit),
            total: jobs.length,
          })),
        ),
      ),
    get_download: ({ downloadId }) => reported(downloads.get(downloadId)),
    preview_link: ({ url }) => reported(downloads.preview(url)),
    download_links: (request) =>
      reported(
        requestDownload(downloads, transcriptions, request).pipe(Effect.map((jobs) => ({ jobs }))),
      ),
    cancel_download: ({ downloadId }) => reported(downloads.cancel(downloadId)),
    retry_download: ({ downloadId }) => reported(downloads.retry(downloadId)),
    import_file: ({ path }) => reported(library.importPath(path)),
    transcribe_recording: ({ mediaId }) =>
      reported(transcriptions.enqueue(mediaId).pipe(Effect.map(summarize))),
    cancel_transcription: ({ mediaId }) =>
      reported(transcriptions.cancel(mediaId).pipe(Effect.map(summarize))),
    retry_transcription: ({ mediaId }) =>
      reported(transcriptions.retry(mediaId).pipe(Effect.map(summarize))),
    edit_transcript: ({ mediaId, ...request }) =>
      reported(transcriptions.edit(mediaId, request, source).pipe(Effect.map(summarize))),
    replace_in_transcript: ({ mediaId, ...request }) =>
      reported(transcriptions.replace(mediaId, request, source).pipe(Effect.map(summarize))),
    list_transcript_changes: ({ mediaId, limit = defaultListLimit, offset = 0 }) =>
      reported(transcriptions.history(mediaId, { limit, offset })),
    restore_transcript: ({ mediaId, ...request }) =>
      reported(transcriptions.restore(mediaId, request, source).pipe(Effect.map(summarize))),
    rename_recording: ({ mediaId, title }) => reported(library.rename(mediaId, title)),
    remove_saved_copy: ({ mediaId }) => reported(transcriptions.removeMediaFile(mediaId)),
    delete_recording: ({ mediaId }) => reported(transcriptions.removeMedia(mediaId)),
  }) satisfies Parameters<typeof movoTools.toLayer>[0];

export function createMcpHandler(services: McpServices) {
  return HttpRouter.toWebHandler(
    McpServer.toolkit(movoTools).pipe(
      Layer.provide(movoTools.toLayer(toolHandlers(services, "mcp"))),
      Layer.provideMerge(
        McpServer.layerHttp({
          name: "movo",
          version: "0.1.0",
          instructions: `Movo is a local media library. Recordings and download jobs are identified by the IDs these tools return. Downloads and transcriptions continue in the background after a tool returns; check them with get_download or get_recording every few seconds. The user installs the transcription model, FFmpeg/FFprobe and yt-dlp in the Movo app at http://127.0.0.1:${services.port}.`,
          path: "/mcp",
          protocols: [
            McpProtocol.v2026_07_28,
            McpProtocol.v2025_11_25,
            McpProtocol.v2025_06_18,
            McpProtocol.v2025_03_26,
          ],
          allowSessionTermination: true,
        }),
      ),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
}

export type McpHandler = ReturnType<typeof createMcpHandler>;
