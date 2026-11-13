import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { link, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gguf } from "@huggingface/gguf";
import { Schema } from "effect";
import type { ModelStatus } from "../../shared/contracts/models.ts";
import { downloadFile } from "../files/download.ts";
import { MediaError } from "../media/error.ts";
import type { ModelDefinition } from "./catalog.ts";

type Availability = Pick<ModelStatus, "state" | "message">;
const ModelMetadata = Schema.Struct({ "general.architecture": Schema.String });
const hasCode = (cause: unknown, code: string) =>
  cause instanceof Error && "code" in cause && cause.code === code;
const fingerprint = (file: Stats) =>
  `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;

export function huggingFaceCacheDirectory(environment: NodeJS.ProcessEnv = process.env) {
  return resolve(
    environment.HF_HUB_CACHE ||
      join(
        environment.HF_HOME ||
          join(environment.XDG_CACHE_HOME || join(homedir(), ".cache"), "huggingface"),
        "hub",
      ),
  );
}

export function modelCachePath(directory: string, definition: ModelDefinition) {
  return join(
    directory,
    `models--${definition.repository.replaceAll("/", "--")}`,
    "snapshots",
    definition.revision,
    definition.filename,
  );
}

async function verifyHeader(path: string, definition: ModelDefinition) {
  try {
    const { metadata } = await gguf(path, { allowLocalFile: true });
    const architecture = Schema.decodeUnknownSync(ModelMetadata)(metadata)["general.architecture"];
    if (architecture !== definition.architecture)
      throw new Error(`Expected ${definition.architecture}, found ${architecture}.`);
  } catch (cause) {
    throw new MediaError(
      "unsupported",
      `The model is not a supported ${definition.name} GGUF file.`,
      cause,
    );
  }
}

export function createModelCache(directory: string, definition: ModelDefinition) {
  const path = modelCachePath(directory, definition);
  let verification: { fingerprint: string; result: Promise<void> } | undefined;
  const verify = async (initial: Stats, signal: AbortSignal) => {
    if (!initial.isFile() || initial.size !== definition.bytes)
      throw new MediaError("unsupported", "The cached model has an unexpected file type or size.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
    if (hash.digest("hex") !== definition.sha256)
      throw new MediaError("unsupported", "The cached model failed its SHA-256 integrity check.");
    signal.throwIfAborted();
    await verifyHeader(path, definition);
    signal.throwIfAborted();
    if (fingerprint(await stat(path)) !== fingerprint(initial))
      throw new MediaError("unavailable", "The model changed during verification. Check again.");
  };
  const inspect = async (signal: AbortSignal, retry = true): Promise<Availability> => {
    signal.throwIfAborted();
    let file;
    try {
      file = await stat(path);
    } catch (cause) {
      if (!hasCode(cause, "ENOENT")) throw cause;
      verification = undefined;
      return { state: "missing", message: null };
    }
    const key = fingerprint(file);
    if (verification?.fingerprint !== key)
      verification = { fingerprint: key, result: verify(file, signal) };
    try {
      await verification.result;
      return { state: "ready", message: null };
    } catch (cause) {
      if (signal.aborted) {
        verification = undefined;
        throw cause;
      }
      if (hasCode(cause, "ENOENT")) {
        verification = undefined;
        return { state: "missing", message: null };
      }
      if (!(cause instanceof MediaError)) throw cause;
      if (cause.reason === "unavailable" && retry) {
        verification = undefined;
        return inspect(signal, false);
      }
      return {
        state: "broken",
        message: `${cause.message} Movo will not overwrite shared weights. Repair or remove this file in your Hugging Face cache, then check again.`,
      };
    }
  };
  return {
    inspect,
    download: async (signal: AbortSignal, progress: (bytes: number) => void) => {
      await mkdir(dirname(path), { recursive: true });
      const partial = join(dirname(path), `.movo-${randomUUID()}.partial`);
      const cleanup = async () => {
        try {
          await rm(partial, { force: true, maxRetries: 3, retryDelay: 100 });
        } catch (cause) {
          throw new MediaError(
            "storage",
            "Could not clean up the temporary model download.",
            cause,
          );
        }
      };
      try {
        await downloadFile(definition, partial, signal, progress);
        const downloaded = await stat(partial);
        await verifyHeader(partial, definition);
        signal.throwIfAborted();
        try {
          await link(partial, path);
          const source = await stat(partial);
          const published = await stat(path);
          if (
            fingerprint(source) !== fingerprint(published) ||
            source.mtimeMs !== downloaded.mtimeMs
          )
            throw new MediaError(
              "unavailable",
              "The model changed during publication. Check again.",
            );
          verification = { fingerprint: fingerprint(published), result: Promise.resolve() };
        } catch (cause) {
          if (!hasCode(cause, "EEXIST"))
            throw cause instanceof MediaError
              ? cause
              : new MediaError(
                  "storage",
                  "Could not publish the model. Check permissions and use a Hugging Face cache on a filesystem that supports hard links.",
                  cause,
                );
          verification = undefined;
          const published = await inspect(signal);
          if (published.state !== "ready")
            throw new MediaError(
              "unavailable",
              published.message ?? "The cached model disappeared.",
            );
        }
      } finally {
        await cleanup();
      }
    },
  };
}
