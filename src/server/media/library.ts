import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  maxImportBytes,
  MediaFileName,
  MediaId,
  MediaItem,
  MediaList,
} from "../../shared/contracts/media.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError } from "./error.ts";
import { mediaItems } from "./media.schema.ts";
import { probeMedia } from "./probe.ts";

const extensions: Record<MediaItem["contentType"], string> = {
  "video/mp4": "mp4",
  "audio/mp4": "m4a",
  "video/webm": "webm",
  "audio/webm": "webm",
  "video/x-matroska": "mkv",
  "audio/x-matroska": "mka",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/ogg": "ogv",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

const storageError = (cause: unknown) =>
  cause instanceof MediaError
    ? cause
    : new MediaError(
        "storage",
        "Could not access the media library. Check disk space and folder permissions.",
        cause,
      );

async function* uploadChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let settled = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        settled = true;
        return;
      }
      yield chunk.value;
    }
  } catch (cause) {
    settled = true;
    throw new MediaError(
      "invalid",
      "The upload was interrupted. Choose the file and try again.",
      cause,
    );
  } finally {
    try {
      if (!settled) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export function createMediaLibrary(
  database: AppDatabase,
  dataDirectory: string,
  resolveProbe: () => Effect.Effect<string, MediaError>,
) {
  const mediaDirectory = join(dataDirectory, "media");
  const filePath = (item: MediaItem) =>
    join(mediaDirectory, `${item.id}.${extensions[item.contentType]}`);

  const get = (id: string) =>
    Effect.try({
      try: () => {
        if (Result.isFailure(Schema.decodeUnknownResult(MediaId)(id)))
          throw new MediaError("notFound", "Media not found.");
        const item = database.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
        if (!item) throw new MediaError("notFound", "Media not found.");
        return Schema.decodeUnknownSync(MediaItem)(item);
      },
      catch: storageError,
    });

  return {
    list: () =>
      Effect.try({
        try: () =>
          Schema.decodeUnknownSync(MediaList)(
            database
              .select()
              .from(mediaItems)
              .orderBy(desc(mediaItems.importedAt), desc(mediaItems.id))
              .all(),
          ),
        catch: storageError,
      }),
    get,
    file: (id: string) =>
      Effect.gen(function* () {
        const item = yield* get(id);
        const path = filePath(item);
        yield* Effect.tryPromise({
          try: async () => {
            const stored = await stat(path);
            if (!stored.isFile() || stored.size !== item.byteSize)
              throw new MediaError(
                "storage",
                "The stored media copy has changed or is incomplete.",
              );
          },
          catch: (cause) =>
            cause instanceof Error && "code" in cause && cause.code === "ENOENT"
              ? new MediaError("notFound", "The stored media copy is missing.", cause)
              : storageError(cause),
        });
        return { item, path };
      }),
    import: (
      body: ReadableStream<Uint8Array> | null,
      originalName: string,
      declaredSize?: number,
    ) =>
      Effect.gen(function* () {
        if (
          !body ||
          originalName === "." ||
          originalName === ".." ||
          Result.isFailure(Schema.decodeUnknownResult(MediaFileName)(originalName))
        ) {
          return yield* Effect.fail(
            new MediaError("invalid", "Choose an audio or video file with a valid filename."),
          );
        }
        if (
          declaredSize !== undefined &&
          (!Number.isSafeInteger(declaredSize) || declaredSize < 1)
        ) {
          return yield* Effect.fail(
            new MediaError("invalid", "The media file is empty or its size is invalid."),
          );
        }
        if (declaredSize !== undefined && declaredSize > maxImportBytes) {
          return yield* Effect.fail(new MediaError("tooLarge", "Files must be 10 GiB or smaller."));
        }
        const ffprobePath = yield* resolveProbe();
        const id = randomUUID();
        const temporaryPath = join(mediaDirectory, `${id}.part`);
        let destination: string | undefined;
        let temporaryCreated = false;
        let committed = false;
        return yield* Effect.gen(function* () {
          const byteSize = yield* Effect.tryPromise({
            try: async () => {
              await mkdir(mediaDirectory, { recursive: true });
              let bytes = 0;
              const counter = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  bytes += chunk.byteLength;
                  callback(
                    bytes > maxImportBytes
                      ? new MediaError("tooLarge", "Files must be 10 GiB or smaller.")
                      : null,
                    chunk,
                  );
                },
              });
              const output = createWriteStream(temporaryPath, { flags: "wx" });
              output.once("open", () => {
                temporaryCreated = true;
              });
              await pipeline(uploadChunks(body), counter, output);
              if (bytes === 0 || (declaredSize !== undefined && bytes !== declaredSize))
                throw new MediaError(
                  "invalid",
                  "The upload was incomplete. Choose the file and try again.",
                );
              return bytes;
            },
            catch: storageError,
          });
          const details = yield* probeMedia(temporaryPath, originalName, ffprobePath);
          const item = yield* Effect.try({
            try: () =>
              Schema.decodeUnknownSync(MediaItem)({
                id,
                originalName,
                title: parse(originalName).name.trim() || originalName,
                byteSize,
                importedAt: Date.now(),
                ...details,
              }),
            catch: storageError,
          });
          yield* Effect.tryPromise({
            try: () => rename(temporaryPath, filePath(item)),
            catch: storageError,
          });
          destination = filePath(item);
          yield* Effect.try({
            try: () => {
              database.insert(mediaItems).values(item).run();
              committed = true;
            },
            catch: storageError,
          });
          return item;
        }).pipe(
          Effect.ensuring(
            Effect.promise(async () => {
              if (temporaryCreated) await rm(temporaryPath, { force: true });
              if (!committed && destination) await rm(destination, { force: true });
            }),
          ),
        );
      }),
  };
}
