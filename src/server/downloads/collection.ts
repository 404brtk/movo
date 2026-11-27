import { Result, Schema } from "effect";
import { collectionPageSize, DownloadCollectionPage } from "../../shared/contracts/downloads.ts";
import {
  isYouTubeChannelId,
  recognizeDownloadSource,
  recognizeYouTubeCollection,
  type YouTubeCollection,
} from "../../shared/download-sources.ts";
import { MediaError } from "../media/error.ts";

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));
const CollectionMetadata = Schema.Struct({
  _type: Schema.Literal("playlist"),
  extractor_key: Schema.Literal("YoutubeTab"),
  id: Schema.String,
  title: OptionalText,
  channel: OptionalText,
  webpage_url: OptionalText,
  channel_id: OptionalText,
  uploader_id: OptionalText,
  availability: OptionalText,
  requested_entries: Schema.optional(
    Schema.Array(Schema.Number.check(Schema.isInt())).check(
      Schema.isMaxLength(collectionPageSize + 1),
    ),
  ),
  entries: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(collectionPageSize + 1)),
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

export function readCollectionPage(raw: string, source: YouTubeCollection, start: number) {
  const metadata = Schema.decodeUnknownSync(CollectionMetadata)(JSON.parse(raw));
  if (!matchesCollection(source, metadata))
    throw new MediaError("unsupported", "YouTube returned details for a different collection.");
  if (!isPublic(metadata.availability) || (start > 1 && metadata.entries.length === 0))
    throw new MediaError(
      "unavailable",
      "These videos are unavailable. Open a public playlist or channel, or try again.",
    );
  const end = start + collectionPageSize;
  const positions = metadata.requested_entries ?? metadata.entries.map((_, index) => start + index);
  if (
    positions.length !== metadata.entries.length ||
    positions.some(
      (position, index) => position <= (positions[index - 1] ?? start - 1) || position > end,
    )
  )
    throw new MediaError("unsupported", "YouTube returned invalid collection positions.");

  const videos = new Map<string, (typeof DownloadCollectionPage.Type.videos)[number]>();
  for (const [index, value] of metadata.entries.entries()) {
    if (positions[index] === end) break;
    const decoded = Schema.decodeUnknownResult(CollectionEntry)(value);
    if (Result.isFailure(decoded)) continue;
    const entry = decoded.success;
    const video = recognizeDownloadSource(entry.url);
    const title = cleanTitle(entry.title);
    if (
      video?.site !== "youtube" ||
      video.id !== entry.id ||
      videos.has(video.id) ||
      !isPublic(entry.availability) ||
      entry.is_live ||
      (entry.live_status != null && !["not_live", "was_live"].includes(entry.live_status)) ||
      (title && /^\[?(?:private|deleted|unavailable) video\]?$/iu.test(title))
    )
      continue;
    videos.set(video.id, {
      url: video.url,
      title: title ?? `Video ${video.id}`,
      durationSeconds: entry.duration && entry.duration > 0 ? entry.duration : null,
    });
  }
  return Schema.decodeUnknownSync(DownloadCollectionPage)({
    title:
      source.kind === "channel"
        ? cleanTitle(metadata.channel) ?? cleanTitle(metadata.title?.replace(/ - Videos$/u, ""))
        : cleanTitle(metadata.title),
    videos: [...videos.values()],
    hasMore: positions.at(-1) === end,
  });
}
