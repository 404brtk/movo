import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter, HttpServer } from "effect/http";
import type {
  Transcript,
  TranscriptChangeSource,
  TranscriptionJob,
} from "../../shared/contracts/transcriptions.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { requestDownload, type Downloads } from "../downloads/jobs.ts";
import { MediaError } from "../media/error.ts";
import type { createMediaLibrary } from "../media/library.ts";
import { ChangeRecordingTags } from "../../shared/contracts/media.ts";
import { tagIdList } from "../../shared/contracts/tags.ts";
import type { Overviews } from "../overview/overviews.ts";
import type { Tags } from "../tags/tags.ts";
import type { Transcriptions } from "../transcriptions/jobs.ts";
import { defaultListLimit, movoTools } from "./tools.ts";
import { defaultPagePassages, transcriptPage } from "./transcript-page.ts";

export interface McpServices {
  library: ReturnType<typeof createMediaLibrary>;
  downloads: Downloads;
  transcriptions: Transcriptions;
  overviews: Pick<Overviews, "get">;
  tags: Tags;
  port: number;
}

const speakerList = (transcript: Transcript) => {
  const speakers = transcriptSpeakers(transcript);
  return speakers.ids.map((id) => ({ id, name: speakers.label(id) }));
};

const summarize = (job: TranscriptionJob | null) =>
  job && {
    ...job,
    transcript: job.transcript && {
      language: job.transcript.language,
      passageCount: transcriptPassages(job.transcript.words).length,
      speakers: speakerList(job.transcript),
    },
  };

const reported = <A>(operation: Effect.Effect<A, MediaError>) =>
  Effect.tapError(operation, (error) =>
    error.reason === "storage" ? Effect.sync(() => console.error(error)) : Effect.void,
  );

const changeRequest = Schema.decodeUnknownEffect(ChangeRecordingTags);

export const toolHandlers = (
  { library, downloads, transcriptions, overviews, tags }: Omit<McpServices, "port">,
  source: TranscriptChangeSource,
  scopeTagIds: readonly string[] = [],
) =>
  ({
    search_library: ({ limit = defaultListLimit, offset = 0, tags: tagNames = [], ...query }) =>
      reported(
        tags.idsForNames(tagNames).pipe(
          Effect.flatMap((tagIds) =>
            library.browse({
              ...query,
              tags: tagIdList([...new Set([...scopeTagIds, ...tagIds])]),
            }),
          ),
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
          overview: overviews.get(mediaId),
        }).pipe(
          Effect.map(({ recording, transcription, overview }) => ({
            recording,
            transcription,
            summary: overview.summary && {
              text: overview.summary.text,
              keyPoints: overview.summary.keyPoints,
            },
            chapters: overview.chapters.map(({ startMs, title }) => ({ startMs, title })),
          })),
        ),
      ),
    read_transcript: ({ mediaId, fromMs = 0, maxPassages = defaultPagePassages }) =>
      reported(
        Effect.flatMap(transcriptions.get(mediaId), (job) =>
          job?.transcript
            ? Effect.succeed({
                language: job.transcript.language,
                revision: job.revision,
                speakers: speakerList(job.transcript),
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
    download_links: ({ tags: tagNames = [], ...request }) =>
      reported(
        tags.idsForNames(tagNames).pipe(
          Effect.flatMap((tagIds) =>
            requestDownload(downloads, transcriptions, { ...request, tagIds }),
          ),
          Effect.map((jobs) => ({ jobs })),
        ),
      ),
    cancel_download: ({ downloadId }) => reported(downloads.cancel(downloadId)),
    retry_download: ({ downloadId }) => reported(downloads.retry(downloadId)),
    import_file: ({ path, tags: tagNames = [] }) =>
      reported(
        tags
          .idsForNames(tagNames)
          .pipe(Effect.flatMap((tagIds) => library.importPath(path, tagIds))),
      ),
    transcribe_recording: ({ mediaId }) =>
      reported(transcriptions.enqueue(mediaId).pipe(Effect.map(summarize))),
    cancel_transcription: ({ mediaId }) =>
      reported(transcriptions.cancel(mediaId).pipe(Effect.map(summarize))),
    retry_transcription: ({ mediaId, speakerModelId }) =>
      reported(transcriptions.retry(mediaId, speakerModelId).pipe(Effect.map(summarize))),
    edit_transcript: ({ mediaId, ...request }) =>
      reported(transcriptions.edit(mediaId, request, source).pipe(Effect.map(summarize))),
    replace_in_transcript: ({ mediaId, ...request }) =>
      reported(transcriptions.replace(mediaId, request, source).pipe(Effect.map(summarize))),
    assign_speaker: ({ mediaId, ...request }) =>
      reported(transcriptions.assignSpeaker(mediaId, request, source).pipe(Effect.map(summarize))),
    merge_speakers: ({ mediaId, ...request }) =>
      reported(transcriptions.mergeSpeakers(mediaId, request, source).pipe(Effect.map(summarize))),
    rename_speaker: ({ mediaId, ...request }) =>
      reported(transcriptions.renameSpeaker(mediaId, request).pipe(Effect.map(summarize))),
    list_transcript_changes: ({ mediaId, limit = defaultListLimit, offset = 0 }) =>
      reported(transcriptions.history(mediaId, { limit, offset })),
    restore_transcript: ({ mediaId, ...request }) =>
      reported(transcriptions.restore(mediaId, request, source).pipe(Effect.map(summarize))),
    rename_recording: ({ mediaId, title }) => reported(library.rename(mediaId, title)),
    remove_saved_copy: ({ mediaId }) => reported(transcriptions.removeMediaFile(mediaId)),
    delete_recording: ({ mediaId }) => reported(transcriptions.removeMedia(mediaId)),
    list_tags: () => reported(tags.list().pipe(Effect.map((list) => ({ tags: list })))),
    create_tag: (request) => reported(tags.create(request)),
    update_tag: ({ tag, ...change }) =>
      reported(
        Effect.gen(function* () {
          if (change.name === undefined && change.color === undefined)
            return yield* Effect.fail(new MediaError("invalid", "Give a new name or colour."));
          return yield* tags.update(yield* tags.idForName(tag), change);
        }),
      ),
    delete_tag: ({ tag }) => reported(tags.idForName(tag).pipe(Effect.flatMap(tags.remove))),
    tag_recordings: ({ mediaIds, add = [], remove = [] }) =>
      reported(
        Effect.gen(function* () {
          const request = yield* changeRequest({
            mediaIds,
            add: yield* tags.idsForNames(add),
            remove: yield* tags.idsForNames(remove),
          }).pipe(
            Effect.mapError(
              (cause) =>
                new MediaError(
                  "invalid",
                  "List each recording once, and name at least one tag to add or remove, never the same tag in both.",
                  cause,
                ),
            ),
          );
          return { recordings: yield* tags.change(request) };
        }),
      ),
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
