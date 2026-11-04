import { Effect, Schema } from "effect";
import { ModelId, ModelStatus, type ModelInstallation } from "../../shared/contracts/models.ts";
import { MediaError } from "../media/error.ts";
import { createModelCache, huggingFaceCacheDirectory } from "./cache.ts";
import { transcriptionModel, type ModelDefinition } from "./catalog.ts";

const modelError = (cause: unknown) =>
  cause instanceof MediaError
    ? cause
    : new MediaError(
        "storage",
        "Could not prepare the model. Check your connection, free disk space and folder permissions, then try again.",
        cause,
      );

export function createModels({
  cacheDirectory = huggingFaceCacheDirectory(),
  definition = transcriptionModel,
}: { cacheDirectory?: string; definition?: ModelDefinition } = {}) {
  const cache = createModelCache(cacheDirectory, definition);
  const lifetime = new AbortController();
  let installation: ModelInstallation = { phase: "idle", downloadedBytes: 0, error: null };
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let closed = false;
  const checkId = (id: string) => {
    if (!Schema.is(ModelId)(id) || id !== definition.id)
      throw new MediaError("notFound", "Model not found.");
  };
  const status = async () =>
    Schema.decodeUnknownSync(ModelStatus)({
      ...definition,
      ...(await cache.inspect(lifetime.signal)),
      installation,
    });
  const failure = (cause: unknown) =>
    closed
      ? new MediaError(
          "unavailable",
          "Movo is shutting down. Restart it before downloading a model.",
          cause,
        )
      : modelError(cause);
  return {
    list: () => Effect.tryPromise({ try: async () => [await status()], catch: failure }),
    install: (id: string) =>
      Effect.tryPromise({
        try: async () => {
          checkId(id);
          const current = await status();
          if (closed) throw failure(undefined);
          if (running || current.state === "ready") return current;
          if (current.state === "broken")
            throw new MediaError(
              "unavailable",
              current.message ?? "The cached model needs repair.",
            );
          controller = new AbortController();
          const operation = controller;
          installation = { phase: "checking", downloadedBytes: 0, error: null };
          const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(30 * 60 * 1000)]);
          running = cache
            .download(signal, (downloadedBytes) => {
              installation = {
                phase: downloadedBytes === definition.bytes ? "verifying" : "downloading",
                downloadedBytes,
                error: null,
              };
            })
            .then(() => {
              installation = { ...installation, phase: "complete" };
              return undefined;
            })
            .catch((cause: unknown) => {
              const cleanupFailed = cause instanceof MediaError && cause.reason === "storage";
              const cancelled = operation.signal.aborted && !closed && !cleanupFailed;
              installation = {
                ...installation,
                phase: cleanupFailed
                  ? "failed"
                  : closed
                    ? "interrupted"
                    : cancelled
                      ? "cancelled"
                      : "failed",
                error: cancelled
                  ? null
                  : closed && !cleanupFailed
                    ? "Movo stopped before the model download finished. Retry to download it again."
                    : modelError(cause).message,
              };
            })
            .finally(() => {
              running = undefined;
              controller = undefined;
            });
          return Schema.decodeUnknownSync(ModelStatus)({ ...current, installation });
        },
        catch: failure,
      }),
    cancel: (id: string) =>
      Effect.tryPromise({
        try: async () => {
          checkId(id);
          controller?.abort();
          await running;
          return status();
        },
        catch: failure,
      }),
    close: () =>
      Effect.promise(async () => {
        closed = true;
        controller?.abort();
        await running;
        lifetime.abort();
      }),
  };
}

export type Models = ReturnType<typeof createModels>;
