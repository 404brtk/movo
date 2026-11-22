import { Effect, Schema, Semaphore } from "effect";
import {
  ModelId,
  ModelStatus,
  SpeakerModelId,
  type ModelInstallation,
} from "../../shared/contracts/models.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError } from "../media/error.ts";
import { createModelCache, huggingFaceCacheDirectory, modelCachePath } from "./cache.ts";
import { modelCatalog, type ModelDefinition, type ModelPaths } from "./catalog.ts";
import { readSpeakerModelId, saveSpeakerModelId } from "./speaker-labels.ts";

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

const settingsStorage = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      new MediaError(
        "storage",
        "Could not access the speaker labels setting. Check the database and disk space.",
        cause,
      ),
  });

const missingMessage = (definition: ModelDefinition) =>
  definition.role === "speakers"
    ? `Speaker labels use ${definition.name}, which is not installed. Download it in Settings or choose another option under Speaker labels.`
    : `Download ${definition.name} from Settings before transcribing a recording.`;

function createModel(cacheDirectory: string, definition: ModelDefinition, onInstalled: () => void) {
  const files = Object.entries(definition.files).map(([role, file]) => ({
    role,
    file,
    cache: createModelCache(cacheDirectory, file),
  }));
  const bytes = files.reduce((total, { file }) => total + file.bytes, 0);
  const lifetime = new AbortController();
  let installation: ModelInstallation = { phase: "idle", downloadedBytes: 0, error: null };
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let closed = false;
  const availability = async () => {
    const states = await Promise.all(files.map(({ cache }) => cache.inspect(lifetime.signal)));
    return (
      states.find((entry) => entry.state === "broken") ??
      states.find((entry) => entry.state === "missing") ?? { state: "ready", message: null }
    );
  };
  const status = async () =>
    Schema.decodeUnknownSync(ModelStatus)({
      ...definition,
      bytes,
      parts: files.map(({ file }) => ({ name: file.title, bytes: file.bytes })),
      ...(await availability()),
      installation,
    });
  const download = async (signal: AbortSignal) => {
    const pending = [];
    let completedBytes = 0;
    for (const { file, cache } of files) {
      const current = await cache.inspect(signal);
      if (current.state === "broken")
        throw new MediaError("unavailable", current.message ?? "The cached model needs repair.");
      if (current.state === "ready") completedBytes += file.bytes;
      else pending.push({ file, cache });
    }
    installation = { ...installation, downloadedBytes: completedBytes };
    for (const { file, cache } of pending) {
      signal.throwIfAborted();
      await cache.download(signal, (fileBytes) => {
        const downloadedBytes = completedBytes + fileBytes;
        installation = {
          phase: downloadedBytes === bytes ? "verifying" : "downloading",
          downloadedBytes,
          error: null,
        };
      });
      completedBytes += file.bytes;
    }
    const installed = await availability();
    if (installed.state !== "ready")
      throw new MediaError(
        "unavailable",
        installed.message ??
          `A file of ${definition.name} was removed during the download. Download it again.`,
      );
  };
  const failure = (cause: unknown) => (closed ? shutdownError(cause) : modelError(cause));
  return {
    status: () => Effect.tryPromise({ try: status, catch: failure }),
    resolve: () =>
      Effect.tryPromise({
        try: async (): Promise<ModelPaths> => {
          if (closed) throw failure(undefined);
          const current = await status();
          if (current.state === "broken")
            throw new MediaError(
              "unavailable",
              current.message ?? "The cached model needs repair.",
            );
          if (current.state === "missing")
            throw new MediaError("unavailable", missingMessage(definition));
          return Object.fromEntries(
            files.map(({ role, file }) => [role, modelCachePath(cacheDirectory, file)]),
          );
        },
        catch: failure,
      }),
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
          running = download(signal)
            .then(() => {
              onInstalled();
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
  database,
  cacheDirectory = huggingFaceCacheDirectory(),
  definitions = modelCatalog,
}: {
  database: AppDatabase;
  cacheDirectory?: string;
  definitions?: readonly ModelDefinition[];
}) {
  const models = new Map(
    definitions.map((definition) => [
      definition.id,
      {
        definition,
        ...createModel(cacheDirectory, definition, () => {
          if (Schema.is(SpeakerModelId)(definition.id)) saveSpeakerModelId(database, definition.id);
        }),
      },
    ]),
  );
  const choosing = Semaphore.makeUnsafe(1);
  const model = (id: string) => {
    const found = Schema.is(ModelId)(id) ? models.get(id) : undefined;
    return found
      ? Effect.succeed(found)
      : Effect.fail(new MediaError("notFound", "Model not found."));
  };
  return {
    list: () =>
      Effect.all({
        models: Effect.forEach([...models.values()], (entry) => entry.status()),
        speakerModelId: settingsStorage(() => readSpeakerModelId(database)),
      }),
    chooseSpeakerLabels: (speakerModelId: SpeakerModelId | null) =>
      Effect.gen(function* () {
        if (speakerModelId !== null) {
          const chosen = yield* model(speakerModelId);
          const status = yield* chosen.status();
          if (status.state !== "ready")
            return yield* Effect.fail(
              new MediaError(
                "invalid",
                status.state === "broken"
                  ? (status.message ?? "The cached model needs repair.")
                  : `Download ${chosen.definition.name} before using it for speaker labels.`,
              ),
            );
        }
        yield* settingsStorage(() => saveSpeakerModelId(database, speakerModelId));
        return { speakerModelId };
      }).pipe(Semaphore.withPermit(choosing)),
    resolve: (id: string) => Effect.flatMap(model(id), (entry) => entry.resolve()),
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
