import { randomUUID } from "node:crypto";
import { Effect, Exit, Result, Schema, Scope } from "effect";
import {
  collectionPageSize,
  DownloadCollectionPage,
  type DownloadCollectionRequest,
} from "../../shared/contracts/downloads.ts";
import {
  isYouTubeChannelId,
  recognizeDownloadSource,
  recognizeYouTubeCollection,
  type YouTubeCollection,
} from "../../shared/download-sources.ts";
import { MediaError } from "../media/error.ts";

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));
const CollectionMetadata = Schema.Struct({
  id: Schema.String,
  title: OptionalText,
  channel: OptionalText,
  webpage_url: OptionalText,
  channel_id: OptionalText,
  uploader_id: OptionalText,
  availability: OptionalText,
});
const CollectionEntry = Schema.Struct({
  _type: Schema.Literal("url"),
  ie_key: Schema.Literal("Youtube"),
  id: Schema.String,
  url: Schema.String,
  title: OptionalText,
  availability: OptionalText,
  live_status: OptionalText,
  is_live: Schema.optional(Schema.NullOr(Schema.Boolean)),
  duration: Schema.optional(Schema.NullOr(Schema.Number.check(Schema.isFinite()))),
});

const isPublic = (availability?: string | null) =>
  availability == null || availability === "public" || availability === "unlisted";

const cleanTitle = (title?: string | null) => title?.trim().slice(0, 512) || null;

function matchesCollection(source: YouTubeCollection, metadata: typeof CollectionMetadata.Type) {
  const reported = metadata.webpage_url
    ? recognizeYouTubeCollection(metadata.webpage_url)
    : undefined;
  if (
    reported?.kind === "mix" ||
    (metadata.webpage_url &&
      (reported?.kind !== source.kind || recognizeDownloadSource(metadata.webpage_url)))
  )
    return false;
  if (source.kind === "playlist")
    return metadata.id === source.id && (!reported || reported.id === source.id);
  if (isYouTubeChannelId(source.id))
    return (
      metadata.id === source.id &&
      (metadata.channel_id == null || metadata.channel_id === source.id) &&
      (!reported ||
        reported.id === source.id ||
        reported.id === metadata.uploader_id?.toLowerCase())
    );
  const handle = metadata.uploader_id?.toLowerCase();
  return (
    (metadata.id.toLowerCase() === source.id ||
      (isYouTubeChannelId(metadata.id) &&
        (metadata.channel_id == null || metadata.channel_id === metadata.id))) &&
    (!handle || handle === source.id) &&
    (!reported || reported.id === source.id || reported.id === metadata.id) &&
    (reported?.id === source.id || handle === source.id || metadata.id.toLowerCase() === source.id)
  );
}

const CollectionEnd = Schema.Struct({
  ...CollectionMetadata.fields,
  _type: Schema.Literal("playlist"),
  extractor_key: Schema.Literal("YoutubeTab"),
});
const ListedEntry = Schema.Struct({
  playlist_id: Schema.String,
  playlist_title: OptionalText,
  playlist_webpage_url: OptionalText,
  playlist_channel: OptionalText,
  playlist_channel_id: OptionalText,
  playlist_uploader_id: OptionalText,
});

const videoPrefix = "MOVO_VIDEO:";
const collectionPrefix = "MOVO_COLLECTION:";

export const collectionArguments = [
  "--use-extractors",
  "youtube:tab",
  "--extractor-args",
  "youtube:raise_incomplete_data",
  "--flat-playlist",
  "--lazy-playlist",
  "--simulate",
  "--print",
  `video:${videoPrefix}%(.{_type,ie_key,id,url,title,availability,live_status,is_live,duration,playlist_id,playlist_title,playlist_webpage_url,playlist_channel,playlist_channel_id,playlist_uploader_id})j`,
  "--print",
  `playlist:${collectionPrefix}%(.{_type,extractor_key,id,title,webpage_url,channel,channel_id,uploader_id,availability})j`,
];

type CollectionPage = typeof DownloadCollectionPage.Type;
type Video = CollectionPage["videos"][number];

function collectionTitle(source: YouTubeCollection, metadata: typeof CollectionMetadata.Type) {
  if (!matchesCollection(source, metadata))
    throw new MediaError("unsupported", "YouTube returned details for a different collection.");
  if (!isPublic(metadata.availability))
    throw new MediaError("unavailable", "This YouTube collection is private or unavailable.");
  return source.kind === "channel"
    ? (cleanTitle(metadata.channel) ?? cleanTitle(metadata.title?.replace(/ - Videos$/u, "")))
    : cleanTitle(metadata.title);
}

function readVideo(value: unknown): Video | undefined {
  const decoded = Schema.decodeUnknownResult(CollectionEntry)(value);
  if (Result.isFailure(decoded)) return undefined;
  const entry = decoded.success;
  const video = recognizeDownloadSource(entry.url);
  const title = cleanTitle(entry.title);
  if (
    video?.site !== "youtube" ||
    video.id !== entry.id ||
    !isPublic(entry.availability) ||
    entry.is_live ||
    (entry.live_status != null && !["not_live", "was_live"].includes(entry.live_status)) ||
    (title && /^\[?(?:private|deleted|unavailable) video\]?$/iu.test(title))
  )
    return undefined;
  return {
    url: video.url,
    title: title ?? `Video ${video.id}`,
    durationSeconds: entry.duration && entry.duration > 0 ? entry.duration : null,
  };
}

async function* readCollection(source: YouTubeCollection, lines: AsyncIterable<string>) {
  let ended = false;
  for await (const line of lines) {
    if (ended) throw new MediaError("unsupported", "YouTube returned more than one collection.");
    if (line.startsWith(collectionPrefix)) {
      const metadata = Schema.decodeUnknownSync(CollectionEnd)(
        JSON.parse(line.slice(collectionPrefix.length)),
      );
      const title = collectionTitle(source, metadata);
      ended = true;
      yield { title, end: true } as const;
    } else if (line.startsWith(videoPrefix)) {
      const value: unknown = JSON.parse(line.slice(videoPrefix.length));
      const entry = Schema.decodeUnknownSync(ListedEntry)(value);
      const title = collectionTitle(source, {
        id: entry.playlist_id,
        title: entry.playlist_title,
        webpage_url: entry.playlist_webpage_url,
        channel: entry.playlist_channel,
        channel_id: entry.playlist_channel_id,
        uploader_id: entry.playlist_uploader_id,
        availability: undefined,
      });
      yield { title, video: readVideo(value), end: false } as const;
    } else throw new MediaError("unsupported", "YouTube returned unexpected collection data.");
  }
  if (!ended) throw new MediaError("unsupported", "YouTube returned an incomplete collection.");
}

function collectionError(cause: unknown) {
  if (!(cause instanceof MediaError))
    return new MediaError("unsupported", "Could not read this YouTube collection.", cause);
  if (/does not have a videos tab/iu.test(cause.message))
    return new MediaError("notFound", "This YouTube channel has no Videos tab.", cause);
  if (/HTTP Error 404/iu.test(cause.message))
    return new MediaError(
      "notFound",
      "YouTube could not find this playlist or channel. Check the link.",
      cause,
    );
  return cause;
}

const idleTimeMs = 5 * 60 * 1000;
const pageTimeoutMs = 45 * 1000;
const maxCollectionSessions = 16;

export function createCollectionPreviews(
  open: (
    source: YouTubeCollection,
  ) => Effect.Effect<AsyncIterable<string>, MediaError, Scope.Scope>,
) {
  type ReadPage = () => Promise<CollectionPage>;
  type Session = { idle: boolean; dispose: () => Promise<void> };
  const sessions = new Set<Session>();
  const cursors = new Map<string, { url: string; read: ReadPage }>();
  let closed = false;

  function start(source: YouTubeCollection) {
    const scope = Scope.makeUnsafe();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousCursor: string | undefined;
    let nextCursor: string | undefined;
    let result: Promise<CollectionPage>;
    let releasing: Promise<void> | undefined;
    const release = () => {
      releasing ??= Effect.runPromise(Scope.close(scope, Exit.void));
      return releasing;
    };
    const session: Session = {
      idle: false,
      dispose: async () => {
        session.idle = false;
        clearTimeout(timer);
        if (previousCursor) cursors.delete(previousCursor);
        if (nextCursor) cursors.delete(nextCursor);
        controller.abort();
        try {
          await release();
        } finally {
          sessions.delete(session);
        }
      },
    };
    const dispose = () => {
      void session.dispose().catch((cause: unknown) => {
        Effect.runFork(Effect.logError("Could not stop the YouTube collection preview.", cause));
      });
    };
    sessions.add(session);
    const lines = Effect.runPromise(Scope.provide(open(source), scope), {
      signal: controller.signal,
    });
    let output: ReturnType<typeof readCollection> | undefined;
    let waiting: Awaited<ReturnType<ReturnType<typeof readCollection>["next"]>> | undefined;

    function read(cursor?: string) {
      if (cursor && cursor === previousCursor) return result;
      clearTimeout(timer);
      session.idle = false;
      if (previousCursor) cursors.delete(previousCursor);
      previousCursor = cursor;
      nextCursor = undefined;
      result = Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            output ??= readCollection(source, await lines);
            waiting ??= await output.next();
            let title: string | null = null;
            const videos = new Map<string, Video>();
            for (
              let index = 0;
              index < collectionPageSize && !waiting.done && !waiting.value.end;
              index++
            ) {
              const { title: listedTitle, video } = waiting.value;
              title = listedTitle;
              if (video && !videos.has(video.url)) videos.set(video.url, video);
              waiting = await output.next();
            }
            if (waiting.done)
              throw new MediaError("unsupported", "YouTube returned an incomplete collection.");
            if (waiting.value.end) {
              title ??= waiting.value.title;
              await output.next();
            }
            return Schema.decodeUnknownSync(DownloadCollectionPage)({
              title,
              videos: [...videos.values()],
              nextCursor: waiting.value.end ? null : randomUUID(),
            });
          },
          catch: collectionError,
        }).pipe(
          Effect.timeoutOrElse({
            duration: pageTimeoutMs,
            orElse: () =>
              Effect.fail(
                new MediaError("unavailable", "YouTube took too long to send these videos."),
              ),
          }),
        ),
        { signal: controller.signal },
      )
        .then(async (page) => {
          controller.signal.throwIfAborted();
          if (page.nextCursor) {
            const token = page.nextCursor;
            nextCursor = token;
            cursors.set(token, { url: source.url, read: () => read(token) });
          } else await release();
          controller.signal.throwIfAborted();
          if (page.nextCursor || cursor) {
            session.idle = true;
            timer = setTimeout(dispose, idleTimeMs);
            timer.unref();
          } else await session.dispose();
          return page;
        })
        .catch(async (cause: unknown) => {
          await session.dispose();
          const error = collectionError(cause);
          if (!cursor) throw error;
          throw new MediaError("conflict", error.message, error);
        });
      return result;
    }
    return { dispose, read };
  }

  return {
    preview: ({ url, cursor }: DownloadCollectionRequest) =>
      Effect.tryPromise({
        try: async (signal) => {
          if (closed) throw new MediaError("unavailable", "The local app is shutting down.");
          const source = recognizeYouTubeCollection(url);
          if (!source || source.kind === "mix" || source.url !== url)
            throw new MediaError("invalid", "Choose a public YouTube playlist or channel.");
          if (cursor) {
            const next = cursors.get(cursor);
            if (next?.url !== url) throw new MediaError("conflict", "This list has expired.");
            return next.read();
          }
          if (sessions.size >= maxCollectionSessions)
            await [...sessions].find((session) => session.idle)?.dispose();
          signal.throwIfAborted();
          if (closed) throw new MediaError("unavailable", "The local app is shutting down.");
          if (sessions.size >= maxCollectionSessions)
            throw new MediaError(
              "unavailable",
              "Too many collections are loading. Try again shortly.",
            );
          const { dispose, read } = start(source);
          signal.addEventListener("abort", dispose, { once: true });
          try {
            return await read();
          } finally {
            signal.removeEventListener("abort", dispose);
          }
        },
        catch: collectionError,
      }),
    close: () =>
      Effect.promise(async () => {
        closed = true;
        await Promise.all([...sessions].map((session) => session.dispose()));
      }),
  };
}
