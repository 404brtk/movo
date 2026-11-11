import { Effect, Schema } from "effect";
import { ModelId, ModelStatus, type ModelInstallation } from "../../shared/contracts/models.ts";
import { MediaError } from "../media/error.ts";
import { createModelCache, huggingFaceCacheDirectory, modelCachePath } from "./cache.ts";
import { modelCatalog, type ModelDefinition } from "./catalog.ts";

const modelError = (cause: unknown) =>
  cause instanceof MediaError
    ? cause
    : new MediaError(
        "storage",
        "Could not prepare the model. Check your connection, free disk space and folder permissions, then try again.",
        cause,
      );

const shutdownError = (cause: unknown) =>
  new MediaError(
    "unavailable",
    "Movo is shutting down. Restart it before downloading a model.",
    cause,
  );

function createModel(cacheDirectory: string, definition: ModelDefinition) {
  const cache = createModelCache(cacheDirectory, definition);
  const lifetime = new AbortController();
  let installation: ModelInstallation = { phase: "idle", downloadedBytes: 0, error: null };
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let closed = false;
  const status = async () =>
    Schema.decodeUnknownSync(ModelStatus)({
      ...definition,
      ...(await cache.inspect(lifetime.signal)),
      installation,
    });
  const failure = (cause: unknown) => (closed ? shutdownError(cause) : modelError(cause));
  const installed = async () => {
    if (closed) throw failure(undefined);
    const current = await status();
    if (current.state === "broken")
      throw new MediaError("unavailable", current.message ?? "The cached model needs repair.");
    return current.state === "ready" ? modelCachePath(cacheDirectory, definition) : null;
  };
  return {
    status: () => Effect.tryPromise({ try: status, catch: failure }),
    resolve: () =>
      Effect.tryPromise({
        try: async () => {
          const path = await installed();
          if (path === null)
            throw new MediaError(
              "unavailable",
              `Download ${definition.name} from Models before transcribing a recording.`,
            );
          return path;
        },
        catch: failure,
      }),
    installed: () => Effect.tryPromise({ try: installed, catch: failure }),
    install: () =>
      Effect.tryPromise({
        try: async () => {
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
    cancel: () =>
      Effect.tryPromise({
        try: async () => {
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

export function createModels({
  cacheDirectory = huggingFaceCacheDirectory(),
  definitions = modelCatalog,
}: { cacheDirectory?: string; definitions?: readonly ModelDefinition[] } = {}) {
  const models = new Map(
    definitions.map((definition) => [definition.id, createModel(cacheDirectory, definition)]),
  );
  const model = (id: string) => {
    const found = Schema.is(ModelId)(id) ? models.get(id) : undefined;
    return found
      ? Effect.succeed(found)
      : Effect.fail(new MediaError("notFound", "Model not found."));
  };
  return {
    list: () => Effect.forEach([...models.values()], (entry) => entry.status()),
    resolve: (id: string) => Effect.flatMap(model(id), (entry) => entry.resolve()),
    installed: (id: string) => Effect.flatMap(model(id), (entry) => entry.installed()),
    install: (id: string) => Effect.flatMap(model(id), (entry) => entry.install()),
    cancel: (id: string) => Effect.flatMap(model(id), (entry) => entry.cancel()),
    close: () =>
      Effect.forEach([...models.values()], (entry) => entry.close(), {
        concurrency: "unbounded",
        discard: true,
      }),
  };
}

export type Models = ReturnType<typeof createModels>;
