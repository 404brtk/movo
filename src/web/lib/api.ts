import { Result, Schema } from "effect";
import { hc } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { AppType } from "../../server/http/app.ts";
import {
  ApiErrorResponse,
  maxImportBytes,
  MediaItem,
  MediaList,
} from "../../shared/contracts/media.ts";

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
      "The local app returned invalid media information.",
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

export function importMedia(file: File) {
  if (file.size === 0)
    throw new ApiError(400, "This file is empty. Choose an audio or video file.");
  if (file.size > maxImportBytes) throw new ApiError(413, "Files must be 10 GiB or smaller.");
  return readResponse(
    client.api.media.$post(
      {},
      { init: { body: file, headers: { "x-file-name": encodeURIComponent(file.name) } } },
    ),
    MediaItem,
  );
}

export const mediaFileUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/file`;
