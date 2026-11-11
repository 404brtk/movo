import { Result, Schema } from "effect";
import { hc } from "hono/client";
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { AppType } from "../../server/http/app.ts";
import {
  AiConnection,
  AiConnectionList,
  AiModelList,
  ChatDetail,
  ChatList,
  DefaultModel,
  LocalServerList,
  ModelChoice,
  type ApprovalDecision,
  type ChatScope,
  type ConnectRequest,
  type Passage,
} from "../../shared/contracts/ask.ts";
import { LibraryList, type LibraryQuery } from "../../shared/contracts/library.ts";
import {
  ApiErrorResponse,
  maxImportBytes,
  MediaItem,
  MediaDeletion,
} from "../../shared/contracts/media.ts";
import {
  activeInstallationPhases,
  MediaToolsStatus,
  type ToolInstallation,
  YtdlpStatus,
} from "../../shared/contracts/media-tools.ts";
import {
  DownloadJob,
  DownloadJobList,
  DownloadPreview,
  type DownloadRequest,
} from "../../shared/contracts/downloads.ts";
import { activeModelPhases, ModelList, ModelStatus } from "../../shared/contracts/models.ts";
import {
  defaultHistoryPage,
  TranscriptHistory,
  TranscriptionJob,
  TranscriptionStatus,
  type PassageEdit,
  type TranscriptExportFormat,
  type TranscriptReplace,
  type TranscriptRestore,
} from "../../shared/contracts/transcriptions.ts";

const client = hc<AppType>("/");
const jsonBody = (body: unknown) => ({
  init: { body: JSON.stringify(body), headers: { "content-type": "application/json" } },
});

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

export const mediaListKey = ["media", "list"] as const;

export const mediaListOptions = (query: LibraryQuery) =>
  queryOptions({
    queryKey: [...mediaListKey, query],
    queryFn: ({ signal }) =>
      readResponse(client.api.media.$get({ query }, { init: { signal } }), LibraryList),
    placeholderData: keepPreviousData,
    refetchInterval: (listing) => (listing.state.data?.transcribing ? 2000 : false),
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

const pollWhileInstalling = (query: {
  state: { data?: { installation: ToolInstallation } | undefined };
}) =>
  activeInstallationPhases.includes(query.state.data?.installation.phase ?? "") ? 1000 : false;

export const mediaToolsOptions = queryOptions({
  queryKey: ["media-tools"],
  queryFn: ({ signal }) =>
    readResponse(client.api["media-tools"].$get({}, { init: { signal } }), MediaToolsStatus),
  refetchInterval: pollWhileInstalling,
  retry: false,
});

export function installMediaTools() {
  return readResponse(client.api["media-tools"].install.$post(), MediaToolsStatus);
}

export const ytdlpOptions = queryOptions({
  queryKey: ["ytdlp"],
  queryFn: ({ signal }) =>
    readResponse(client.api.ytdlp.$get({}, { init: { signal } }), YtdlpStatus),
  refetchInterval: pollWhileInstalling,
  retry: false,
});

export function installYtdlp() {
  return readResponse(client.api.ytdlp.install.$post(), YtdlpStatus);
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
  readResponse(client.api.media[":id"].$patch({ param: { id } }, jsonBody({ title })), MediaItem);
export const deleteMedia = (id: string) =>
  readResponse(client.api.media[":id"].$delete({ param: { id } }), MediaDeletion);
export const removeMediaFile = (id: string) =>
  readResponse(client.api.media[":id"].file.$delete({ param: { id } }), MediaDeletion);
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

export const enqueueDownload = (request: DownloadRequest) =>
  readResponse(client.api.downloads.$post({}, jsonBody(request)), DownloadJobList);
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
export const transcriptHistoryOptions = (id: string, revision: number) =>
  infiniteQueryOptions({
    queryKey: [...transcriptionOptions(id).queryKey, "changes", revision],
    queryFn: ({ pageParam, signal }) =>
      readResponse(
        client.api.media[":id"].transcription.changes.$get(
          {
            param: { id },
            query: { limit: String(defaultHistoryPage), offset: String(pageParam) },
          },
          { init: { signal } },
        ),
        TranscriptHistory,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((total, page) => total + page.changes.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
export const editTranscript = (id: string, edit: PassageEdit) =>
  readResponse(
    client.api.media[":id"].transcription.edit.$post({ param: { id } }, jsonBody(edit)),
    TranscriptionJob,
  );
export const replaceInTranscript = (id: string, replace: TranscriptReplace) =>
  readResponse(
    client.api.media[":id"].transcription.replace.$post({ param: { id } }, jsonBody(replace)),
    TranscriptionJob,
  );
export const restoreTranscript = (id: string, restore: TranscriptRestore) =>
  readResponse(
    client.api.media[":id"].transcription.restore.$post({ param: { id } }, jsonBody(restore)),
    TranscriptionJob,
  );

const minute = 60_000;
export const askKey = ["ask"] as const;
export const connectionsOptions = queryOptions({
  queryKey: [...askKey, "connections"],
  queryFn: ({ signal }) =>
    readResponse(client.api.ask.connections.$get({}, { init: { signal } }), AiConnectionList),
  retry: false,
});
export const connectionModelsOptions = (id: string, kind: string) =>
  queryOptions({
    queryKey: [...askKey, "models", id],
    queryFn: ({ signal }) =>
      readResponse(
        client.api.ask.connections[":id"].models.$get({ param: { id } }, { init: { signal } }),
        AiModelList,
      ),
    staleTime: kind === "server" ? minute / 2 : 60 * minute,
    retry: false,
  });
export const localServersOptions = queryOptions({
  queryKey: [...askKey, "local"],
  queryFn: ({ signal }) =>
    readResponse(client.api.ask.local.$get({}, { init: { signal } }), LocalServerList),
  staleTime: minute / 2,
  refetchInterval: minute / 2,
  retry: false,
});
export const defaultModelOptions = queryOptions({
  queryKey: [...askKey, "default"],
  queryFn: ({ signal }) =>
    readResponse(client.api.ask.default.$get({}, { init: { signal } }), DefaultModel),
  retry: false,
});
export const connectService = (request: ConnectRequest) =>
  readResponse(client.api.ask.connections.$post({}, jsonBody(request)), AiConnection);
export const disconnectService = (id: string) =>
  readResponse(client.api.ask.connections[":id"].$delete({ param: { id } }), AiConnection);
export const setDefaultModel = (choice: ModelChoice) =>
  readResponse(client.api.ask.default.$put({}, jsonBody(choice)), ModelChoice);

export const chatListOptions = (mediaId: string | null) =>
  queryOptions({
    queryKey: [...askKey, "chats", mediaId],
    queryFn: ({ signal }) =>
      readResponse(
        client.api.ask.chats.$get({ query: mediaId ? { mediaId } : {} }, { init: { signal } }),
        ChatList,
      ),
    retry: false,
  });
export const chatOptions = (id: string) =>
  queryOptions({
    queryKey: [...askKey, "chat", id],
    queryFn: ({ signal }) =>
      readResponse(
        client.api.ask.chats[":id"].$get({ param: { id } }, { init: { signal } }),
        ChatDetail,
      ),
    retry: false,
  });
export const createChat = (mediaId: string | null, scope: ChatScope | null = null) =>
  readResponse(client.api.ask.chats.$post({}, jsonBody({ mediaId, scope })), ChatDetail);
export const askQuestion = (id: string, text: string, passage: Passage | null) =>
  readResponse(
    client.api.ask.chats[":id"].messages.$post(
      { param: { id } },
      jsonBody(passage ? { text, passage } : { text }),
    ),
    ChatDetail,
  );
export const setChatScope = (id: string, scope: ChatScope | null) =>
  readResponse(
    client.api.ask.chats[":id"].scope.$put({ param: { id } }, jsonBody({ scope })),
    ChatDetail,
  );
export async function deleteChat(id: string) {
  let response: Response;
  try {
    response = await client.api.ask.chats[":id"].$delete({ param: { id } });
  } catch (cause) {
    throw new ApiError(
      0,
      "Could not reach the local app. Check that it is running and try again.",
      cause,
    );
  }
  if (!response.ok) await readResponse(Promise.resolve(response), ChatDetail);
}
export const stopAnswer = (id: string) =>
  readResponse(client.api.ask.chats[":id"].stop.$post({ param: { id } }), ChatDetail);
export const decideApproval = (id: string, decision: ApprovalDecision) =>
  readResponse(
    client.api.ask.chats[":id"].approval.$post({ param: { id } }, jsonBody(decision)),
    ChatDetail,
  );
export const setChatModel = (id: string, choice: ModelChoice) =>
  readResponse(
    client.api.ask.chats[":id"].model.$put({ param: { id } }, jsonBody(choice)),
    ChatDetail,
  );
export const liveAnswerUrl = (id: string) => `/api/ask/chats/${encodeURIComponent(id)}/live`;
