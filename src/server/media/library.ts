import { randomUUID } from "node:crypto";
import { createWriteStream, lstatSync, readdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, parse, relative } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, getTableColumns, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  librarySort,
  type LibraryItem,
  type LibraryList,
  type LibraryQuery,
  type LibrarySort,
  type LibraryTranscription,
} from "../../shared/contracts/library.ts";
import {
  maxImportBytes,
  MediaFileName,
  MediaId,
  MediaItem,
  MediaTitle,
  type MediaDeletion,
} from "../../shared/contracts/media.ts";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { searchTerms } from "../../shared/search-text.ts";
import type { AppDatabase } from "../db/database.ts";
import { downloadJobs } from "../downloads/downloads.schema.ts";
import { transcriptionJobs } from "../transcriptions/transcriptions.schema.ts";
import { clearHistory } from "../transcriptions/history.ts";
import { queueTranscription } from "../transcriptions/queue.ts";
import { MediaError } from "./error.ts";
import { mediaItems } from "./media.schema.ts";
import { probeMedia } from "./probe.ts";
import {
  addSearchEntry,
  describeMatch,
  findPassageMatches,
  rankSearchMatches,
  removeSearchEntry,
  setSearchTitle,
  syncSearchIndex,
} from "./search.ts";

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

const titleOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const newestFirst = (first: MediaItem, second: MediaItem) =>
  second.importedAt - first.importedAt ||
  (first.id < second.id ? 1 : first.id > second.id ? -1 : 0);

function compareItems(sort: LibrarySort, ranks: ReadonlyMap<string, number> | null) {
  const comparators: Record<LibrarySort, (first: MediaItem, second: MediaItem) => number> = {
    relevance: (first, second) =>
      (ranks?.get(first.id) ?? 0) - (ranks?.get(second.id) ?? 0) || newestFirst(first, second),
    newest: newestFirst,
    oldest: (first, second) => newestFirst(second, first),
    title: (first, second) =>
      titleOrder.compare(first.title, second.title) || newestFirst(first, second),
  };
  return comparators[sort];
}

function describeTranscription(
  status: TranscriptionJob["status"] | null,
  transcribed: boolean,
): LibraryTranscription {
  if (status === "queued" || status === "running") return "active";
  if (transcribed) return "done";
  return status === null ? "none" : "stopped";
}

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
  const pendingPath = (item: MediaItem) => `${filePath(item)}.deleting`;
  const restorePending = (item: MediaItem) => {
    const pending = pendingPath(item);
    const stored = lstatSync(pending, { throwIfNoEntry: false });
    if (!stored) return;
    if (!stored.isFile() || lstatSync(filePath(item), { throwIfNoEntry: false }))
      throw new MediaError(
        "storage",
        "Could not restore a pending media deletion without overwriting an existing file.",
      );
    renameSync(pending, filePath(item));
  };

  const read = (id: string) => {
    if (Result.isFailure(Schema.decodeUnknownResult(MediaId)(id)))
      throw new MediaError("notFound", "Media not found.");
    const item = database.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
    if (!item) throw new MediaError("notFound", "Media not found.");
    return Schema.decodeUnknownSync(MediaItem)(item);
  };
  const get = (id: string) =>
    Effect.try({
      try: () => read(id),
      catch: storageError,
    });

  const discardCopy = (
    item: MediaItem,
    {
      purpose,
      cleanupError,
      commit,
    }: {
      purpose: string;
      cleanupError: string;
      commit: (
        transaction: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
        item: MediaItem,
        downloads: (typeof downloadJobs.$inferSelect)[],
      ) => MediaItem;
    },
  ): MediaDeletion => {
    const id = item.id;
    restorePending(item);
    let moved = false;
    let result: MediaItem;
    try {
      result = database.transaction((transaction) => {
        const transcription = transaction
          .select()
          .from(transcriptionJobs)
          .where(eq(transcriptionJobs.mediaId, id))
          .get();
        const downloads = transaction
          .select()
          .from(downloadJobs)
          .where(or(eq(downloadJobs.mediaId, id), eq(downloadJobs.id, id)))
          .all();
        if (transcription && ["queued", "running"].includes(transcription.status))
          throw new MediaError("conflict", `Cancel the transcription before ${purpose}.`);
        if (downloads.some((job) => ["queued", "running"].includes(job.status)))
          throw new MediaError("conflict", `Wait for the download to finish before ${purpose}.`);
        const stored = lstatSync(filePath(item), { throwIfNoEntry: false });
        if (stored) {
          if (!stored.isFile())
            throw new MediaError("storage", "Could not access the stored media copy.");
          renameSync(filePath(item), pendingPath(item));
          moved = true;
        }
        return commit(transaction, item, downloads);
      });
    } catch (cause) {
      if (moved) {
        try {
          restorePending(item);
        } catch (restoreCause) {
          throw new MediaError(
            "storage",
            "The change failed and its saved copy could not be restored. Close apps using it, check folder permissions, then restart Movo to recover it.",
            new AggregateError([cause, restoreCause]),
          );
        }
      }
      throw cause;
    }
    if (moved) {
      try {
        unlinkSync(pendingPath(item));
      } catch {
        return { ...result, cleanupError };
      }
    }
    return result;
  };

  const save = (
    path: string,
    originalName: string,
    title: string,
    sourceUrl: string | null,
    byteSize: number,
    id: string,
    transcribe = false,
  ) =>
    Effect.gen(function* () {
      const ffprobePath = yield* resolveProbe();
      const details = yield* probeMedia(path, originalName, ffprobePath);
      const item = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(MediaItem)({
            id,
            originalName,
            title,
            sourceUrl,
            fileRemovedAt: null,
            byteSize,
            importedAt: Date.now(),
            ...details,
          }),
        catch: storageError,
      });
      let moved = false;
      let committed = false;
      return yield* Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(mediaDirectory, { recursive: true });
            await rename(path, filePath(item));
            moved = true;
          },
          catch: storageError,
        });
        yield* Effect.try({
          try: () => {
            database.transaction((transaction) => {
              transaction.insert(mediaItems).values(item).run();
              addSearchEntry(transaction, item);
              if (transcribe) queueTranscription(transaction, item.id);
            });
            committed = true;
          },
          catch: storageError,
        });
        return item;
      }).pipe(
        Effect.uninterruptible,
        Effect.ensuring(
          Effect.promise(async () => {
            if (moved && !committed) await rm(filePath(item), { force: true });
          }),
        ),
      );
    });

  const listItems = (query: LibraryQuery): LibraryItem[] => {
    const terms = searchTerms(query.q ?? "");
    const ranks = terms.length > 0 ? rankSearchMatches(database, terms) : null;
    if (ranks?.size === 0) return [];
    const rows = database
      .select({
        item: getTableColumns(mediaItems),
        status: transcriptionJobs.status,
        transcribed: sql<number>`${transcriptionJobs.transcript} is not null`,
      })
      .from(mediaItems)
      .leftJoin(transcriptionJobs, eq(transcriptionJobs.mediaId, mediaItems.id))
      .where(
        and(
          query.kind ? eq(mediaItems.kind, query.kind) : undefined,
          query.transcript === "available"
            ? isNotNull(transcriptionJobs.transcript)
            : query.transcript === "missing"
              ? isNull(transcriptionJobs.transcript)
              : undefined,
          ranks ? inArray(mediaItems.id, [...ranks.keys()]) : undefined,
        ),
      )
      .all();
    const items = rows.map(({ item, status, transcribed }) => ({
      ...Schema.decodeUnknownSync(MediaItem)(item),
      transcription: describeTranscription(status, transcribed === 1),
    }));
    const ordered = items.toSorted(compareItems(librarySort(query), ranks));
    if (!ranks) return ordered;
    const passages = findPassageMatches(
      database,
      terms,
      ordered.map((item) => item.id),
    );
    return ordered.map((item) => ({
      ...item,
      match: describeMatch(item.title, passages.get(item.id), terms),
    }));
  };

  const importMedia = (
    body: ReadableStream<Uint8Array> | Readable | null,
    originalName: string,
    declaredSize?: number,
    transcribe = false,
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
      if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 1)) {
        return yield* Effect.fail(
          new MediaError("invalid", "The media file is empty or its size is invalid."),
        );
      }
      if (declaredSize !== undefined && declaredSize > maxImportBytes) {
        return yield* Effect.fail(new MediaError("tooLarge", "Files must be 10 GiB or smaller."));
      }
      yield* resolveProbe();
      const id = randomUUID();
      const temporaryPath = join(mediaDirectory, `${id}.part`);
      let temporaryCreated = false;
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
            await pipeline(body instanceof Readable ? body : uploadChunks(body), counter, output);
            if (bytes === 0 || (declaredSize !== undefined && bytes !== declaredSize))
              throw new MediaError(
                "invalid",
                "The upload was incomplete. Choose the file and try again.",
              );
            return bytes;
          },
          catch: storageError,
        }).pipe(Effect.uninterruptible);
        return yield* save(
          temporaryPath,
          originalName,
          parse(originalName).name.trim() || originalName,
          null,
          byteSize,
          id,
          transcribe,
        );
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            if (temporaryCreated) await rm(temporaryPath, { force: true });
          }),
        ),
      );
    });
  return {
    recoverDeletions: () =>
      Effect.try({
        try: () => {
          if (!lstatSync(mediaDirectory, { throwIfNoEntry: false })) return;
          for (const entry of readdirSync(mediaDirectory, { withFileTypes: true })) {
            if (!entry.name.endsWith(".deleting")) continue;
            const originalName = entry.name.slice(0, -".deleting".length);
            const { name: id, ext } = parse(originalName);
            if (
              !entry.isFile() ||
              !Schema.is(MediaId)(id) ||
              !Object.values(extensions).includes(ext.slice(1))
            )
              throw new MediaError(
                "storage",
                "An invalid pending media deletion needs manual recovery.",
              );
            const row = database.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
            if (row && row.fileRemovedAt === null) {
              const item = Schema.decodeUnknownSync(MediaItem)(row);
              if (basename(filePath(item)) !== originalName)
                throw new MediaError(
                  "storage",
                  "A pending media deletion does not match its saved metadata.",
                );
              restorePending(item);
            } else {
              unlinkSync(join(mediaDirectory, entry.name));
            }
          }
        },
        catch: storageError,
      }),
    adoptDownload: (path: string, title: string, sourceUrl: string, id: string) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => Schema.decodeUnknownSync(MediaId)(id),
          catch: (cause) => new MediaError("invalid", "Invalid download identifier.", cause),
        });
        const stored = yield* Effect.tryPromise({
          try: async () => {
            const root = await realpath(join(dataDirectory, "downloads", id));
            const source = await realpath(path);
            const within = relative(root, source);
            const file = await lstat(path);
            if (
              !within ||
              within.startsWith("..") ||
              isAbsolute(within) ||
              !file.isFile() ||
              file.isSymbolicLink()
            )
              throw new MediaError(
                "invalid",
                "The downloaded file is outside its managed job directory.",
              );
            if (file.size < 1 || file.size > maxImportBytes)
              throw new MediaError("tooLarge", "Files must be nonempty and 10 GiB or smaller.");
            return file;
          },
          catch: storageError,
        });
        return yield* save(path, basename(path), title, sourceUrl, stored.size, id);
      }),
    syncSearchIndex: () =>
      Effect.try({ try: () => syncSearchIndex(database), catch: storageError }),
    list: (query: LibraryQuery = {}) =>
      Effect.try({ try: () => listItems(query), catch: storageError }),
    browse: (query: LibraryQuery) =>
      Effect.try({
        try: (): LibraryList => ({
          items: listItems(query),
          transcribing:
            database
              .select({ mediaId: transcriptionJobs.mediaId })
              .from(transcriptionJobs)
              .where(inArray(transcriptionJobs.status, ["queued", "running"]))
              .limit(1)
              .get() !== undefined,
        }),
        catch: storageError,
      }),
    get,
    rename: (id: string, title: string) =>
      Effect.try({
        try: () => {
          const item = read(id);
          const trimmed = title.trim();
          if (!Schema.is(MediaTitle)(trimmed))
            throw new MediaError(
              "invalid",
              "Use a title of 1–512 characters without control characters.",
            );
          database.transaction((transaction) => {
            transaction
              .update(mediaItems)
              .set({ title: trimmed })
              .where(eq(mediaItems.id, id))
              .run();
            setSearchTitle(transaction, id, trimmed);
          });
          return { ...item, title: trimmed };
        },
        catch: storageError,
      }),
    remove: (id: string): Effect.Effect<MediaDeletion, MediaError> =>
      Effect.try({
        try: () =>
          discardCopy(read(id), {
            purpose: "deleting this recording",
            cleanupError:
              "The recording was removed from the library, but its saved copy could not be cleaned up. Close apps using it or check folder permissions, then restart Movo to retry cleanup.",
            commit: (transaction, item, downloads) => {
              for (const directory of [
                join(dataDirectory, "transcriptions", id),
                ...downloads.map((job) =>
                  join(dataDirectory, "downloads", Schema.decodeUnknownSync(MediaId)(job.id)),
                ),
              ])
                rmSync(directory, { recursive: true, force: true });
              clearHistory(transaction, id);
              transaction.delete(transcriptionJobs).where(eq(transcriptionJobs.mediaId, id)).run();
              transaction
                .delete(downloadJobs)
                .where(or(eq(downloadJobs.mediaId, id), eq(downloadJobs.id, id)))
                .run();
              removeSearchEntry(transaction, id);
              transaction.delete(mediaItems).where(eq(mediaItems.id, id)).run();
              return item;
            },
          }),
        catch: storageError,
      }),
    removeFile: (id: string): Effect.Effect<MediaDeletion, MediaError> =>
      Effect.try({
        try: () => {
          const stored = read(id);
          if (stored.fileRemovedAt !== null) return stored;
          if (
            !database
              .select({ transcript: transcriptionJobs.transcript })
              .from(transcriptionJobs)
              .where(eq(transcriptionJobs.mediaId, id))
              .get()?.transcript
          )
            throw new MediaError(
              "conflict",
              "Transcribe this recording before removing its saved copy.",
            );
          return discardCopy(stored, {
            purpose: "removing its saved copy",
            cleanupError:
              "The transcript was kept, but the saved copy could not be cleaned up. Close apps using it or check folder permissions, then restart Movo to retry cleanup.",
            commit: (transaction, item) => {
              const fileRemovedAt = Date.now();
              transaction
                .update(mediaItems)
                .set({ fileRemovedAt })
                .where(eq(mediaItems.id, id))
                .run();
              return { ...item, fileRemovedAt };
            },
          });
        },
        catch: storageError,
      }),
    file: (id: string) =>
      Effect.gen(function* () {
        const item = yield* get(id);
        if (item.fileRemovedAt !== null)
          return yield* Effect.fail(
            new MediaError(
              "notFound",
              "The saved copy of this recording was removed. Its transcript is still available.",
            ),
          );
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
    import: importMedia,
    importPath: (path: string) =>
      Effect.gen(function* () {
        if (!isAbsolute(path))
          return yield* Effect.fail(
            new MediaError("invalid", "Provide an absolute path to an audio or video file."),
          );
        const file = yield* Effect.tryPromise({
          try: () => stat(path),
          catch: (cause) =>
            new MediaError("notFound", "The file does not exist or cannot be read.", cause),
        });
        if (!file.isFile())
          return yield* Effect.fail(
            new MediaError("invalid", "The path must point to an audio or video file."),
          );
        return yield* Effect.acquireUseRelease(
          Effect.tryPromise({
            try: () => open(path, "r"),
            catch: (cause) =>
              new MediaError("notFound", "The file does not exist or cannot be read.", cause),
          }),
          (handle) =>
            importMedia(handle.createReadStream({ autoClose: false }), basename(path), file.size),
          (handle) => Effect.promise(() => handle.close()),
        );
      }),
  };
}
