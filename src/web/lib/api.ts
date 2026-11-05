import { Result, Schema } from "effect";
import { hc } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { AppType } from "../../server/http/app.ts";
import {
  ApiErrorResponse,
  maxImportBytes,
  MediaItem,
  MediaDeletion,
  MediaList,
} from "../../shared/contracts/media.ts";
import { activeInstallationPhases, MediaToolsStatus } from "../../shared/contracts/media-tools.ts";
import { DownloadJob, DownloadJobList, DownloadPreview } from "../../shared/contracts/downloads.ts";
import { activeModelPhases, ModelList, ModelStatus } from "../../shared/contracts/models.ts";
import {
  TranscriptionJob,
  TranscriptionStatus,
  type TranscriptExportFormat,
} from "../../shared/contracts/transcriptions.ts";

const client = hc<AppType>("/");

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
  }
}

async function readResponse<S extends Schema.ConstraintDecoder<unknown>>(
  request: Promise<Response>,
  schema: S,
): Promise<S["Type"]> {
  let response: Response;
  try {
    response = await request;
  } catch (cause) {
    throw new ApiError(
      0,
      "Could not reach the local app. Check that it is running and try again.",
      cause,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ApiError(
      response.status,
      "The local app returned an unreadable response. Try again.",
      cause,
    );
  }
  if (!response.ok) {
    const error = Schema.decodeUnknownResult(ApiErrorResponse)(payload);
    throw new ApiError(
      response.status,
      Result.isSuccess(error)
        ? error.success.error
        : `The local app returned HTTP ${response.status}.`,
    );
  }
  const result = Schema.decodeUnknownResult(schema)(payload);
  if (Result.isFailure(result))
    throw new ApiError(
      response.status,
      "The local app returned invalid information.",
      result.failure,
    );
  return result.success;
}

export const mediaListOptions = queryOptions({
  queryKey: ["media"],
  queryFn: ({ signal }) => readResponse(client.api.media.$get({}, { init: { signal } }), MediaList),
  retry: false,
});

export const mediaItemOptions = (id: string) =>
  queryOptions({
    queryKey: ["media", id],
    queryFn: ({ signal }) =>
      readResponse(
        client.api.media[":id"].$get({ param: { id } }, { init: { signal } }),
        MediaItem,
      ),
    retry: false,
  });

export const mediaToolsOptions = queryOptions({
  queryKey: ["media-tools"],
  queryFn: ({ signal }) =>
    readResponse(client.api["media-tools"].$get({}, { init: { signal } }), MediaToolsStatus),
  refetchInterval: (query) =>
    activeInstallationPhases.includes(query.state.data?.installation.phase ?? "") ? 1000 : false,
  retry: false,
});

export function installMediaTools() {
  return readResponse(client.api["media-tools"].install.$post(), MediaToolsStatus);
}

export async function importMedia(file: File) {
  if (file.size === 0)
    throw new ApiError(400, "This file is empty. Choose an audio or video file.");
  if (file.size > maxImportBytes) throw new ApiError(413, "Files must be 10 GiB or smaller.");
  const tools = await readResponse(client.api["media-tools"].$get(), MediaToolsStatus);
  if (tools.ffprobe.state !== "ready")
    throw new ApiError(
      503,
      tools.ffprobe.state === "broken"
        ? tools.ffprobe.message
        : "Download media tools before importing a file.",
    );
  return readResponse(
    client.api.media.$post(
      {},
      { init: { body: file, headers: { "x-file-name": encodeURIComponent(file.name) } } },
    ),
    MediaItem,
  );
}

export const mediaFileUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/file`;
export const renameMedia = (id: string, title: string) =>
  readResponse(
    client.api.media[":id"].$patch(
      { param: { id } },
      {
        init: { body: JSON.stringify({ title }), headers: { "content-type": "application/json" } },
      },
    ),
    MediaItem,
  );
export const deleteMedia = (id: string) =>
  readResponse(client.api.media[":id"].$delete({ param: { id } }), MediaDeletion);
export const transcriptionExportUrl = (id: string, format: TranscriptExportFormat) =>
  `/api/media/${encodeURIComponent(id)}/transcription/export/${format}`;

export const modelsOptions = queryOptions({
  queryKey: ["models"],
  queryFn: ({ signal }) =>
    readResponse(client.api.models.$get({}, { init: { signal } }), ModelList),
  refetchInterval: (query) =>
    query.state.data?.some((model) => activeModelPhases.includes(model.installation.phase))
      ? 1000
      : false,
  retry: false,
});
export const installModel = (id: string) =>
  readResponse(client.api.models[":id"].install.$post({ param: { id } }), ModelStatus);
export const cancelModelInstallation = (id: string) =>
  readResponse(client.api.models[":id"].cancel.$post({ param: { id } }), ModelStatus);

export const downloadsOptions = queryOptions({
  queryKey: ["downloads"],
  queryFn: ({ signal }) =>
    readResponse(client.api.downloads.$get({}, { init: { signal } }), DownloadJobList),
  refetchInterval: (query) =>
    query.state.data?.some((job) => job.status === "queued" || job.status === "running")
      ? 1000
      : false,
  retry: false,
});

export const previewOptions = (url: string) =>
  queryOptions({
    queryKey: ["download-preview", url],
    queryFn: ({ signal }) =>
      readResponse(
        client.api.downloads.preview.$post(
          {},
          {
            init: {
              signal,
              body: JSON.stringify({ url }),
              headers: { "content-type": "application/json" },
            },
          },
        ),
        DownloadPreview,
      ),
    enabled: Boolean(url),
    staleTime: Infinity,
    retry: false,
  });

export const enqueueDownload = (url: string) =>
  readResponse(
    client.api.downloads.$post(
      {},
      { init: { body: JSON.stringify({ url }), headers: { "content-type": "application/json" } } },
    ),
    DownloadJob,
  );
export const cancelDownload = (id: string) =>
  readResponse(client.api.downloads[":id"].cancel.$post({ param: { id } }), DownloadJob);
export const retryDownload = (id: string) =>
  readResponse(client.api.downloads[":id"].retry.$post({ param: { id } }), DownloadJob);

export const transcriptionOptions = (id: string) =>
  queryOptions({
    queryKey: ["transcription", id],
    queryFn: ({ signal }) =>
      readResponse(
        client.api.media[":id"].transcription.$get({ param: { id } }, { init: { signal } }),
        TranscriptionStatus,
      ),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "") ? 1000 : false,
    retry: false,
  });
export const enqueueTranscription = (id: string) =>
  readResponse(client.api.media[":id"].transcription.$post({ param: { id } }), TranscriptionJob);
export const cancelTranscription = (id: string) =>
  readResponse(
    client.api.media[":id"].transcription.cancel.$post({ param: { id } }),
    TranscriptionStatus,
  );
export const retryTranscription = (id: string) =>
  readResponse(
    client.api.media[":id"].transcription.retry.$post({ param: { id } }),
    TranscriptionJob,
  );
