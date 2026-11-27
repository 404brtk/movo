import { Schema } from "effect";
import { maxDownloadLinkLength, recognizeDownloadSource } from "../download-sources.ts";
import { MediaId } from "./media.ts";
import { maxTags, TagId, TagIds } from "./tags.ts";

export const downloadPresets = [
  { id: "video-480p", kind: "video", maxHeight: 480, label: "Up to 480p" },
  { id: "video-720p", kind: "video", maxHeight: 720, label: "Up to 720p" },
  { id: "video-1080p", kind: "video", maxHeight: 1080, label: "Up to 1080p" },
  { id: "video-best", kind: "video", maxHeight: null, label: "Best available" },
  { id: "audio", kind: "audio", maxHeight: null, label: "Best available" },
] as const;
export const DownloadPreset = Schema.Literals(downloadPresets.map((preset) => preset.id));
export type DownloadPreset = typeof DownloadPreset.Type;
export const defaultDownloadPreset: DownloadPreset = "video-1080p";
export const downloadSiteNames =
  "YouTube, X, TikTok, Instagram, Facebook, Twitch, Apple Podcasts, Google Drive or Dropbox";

export function getDownloadPreset(id: DownloadPreset) {
  const preset = downloadPresets.find((option) => option.id === id);
  if (!preset) throw new Error("Unknown download preset.");
  return preset;
}

export const downloadStates = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const retryableDownloadStates: ReadonlySet<(typeof downloadStates)[number]> = new Set([
  "failed",
  "cancelled",
  "interrupted",
]);
export const DownloadPreviewRequest = Schema.Struct({ url: Schema.String });
const DownloadTitle = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const DownloadLinkRequest = Schema.Struct({
  url: Schema.String,
  preset: Schema.optional(DownloadPreset),
  title: Schema.optional(DownloadTitle),
});
export type DownloadLinkRequest = typeof DownloadLinkRequest.Type;
export const DownloadRequest = Schema.Struct({
  links: Schema.Array(DownloadLinkRequest).check(Schema.isMinLength(1)),
  transcribe: Schema.optional(Schema.Boolean),
  tagIds: Schema.optional(TagIds),
});
export type DownloadRequest = typeof DownloadRequest.Type;
export const DownloadSourceDetails = Schema.Struct({
  url: Schema.String,
  title: DownloadTitle,
  durationSeconds: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
});
export type DownloadSourceDetails = typeof DownloadSourceDetails.Type;
export const SavedDownload = Schema.Struct({ preset: DownloadPreset, mediaId: MediaId });
export const DownloadPreview = Schema.Struct({
  ...DownloadSourceDetails.fields,
  saved: Schema.Array(SavedDownload),
});
export type DownloadPreview = typeof DownloadPreview.Type;
export const collectionPageSize = 50;
const CollectionCursor = Schema.String.check(Schema.isUUID());
export const DownloadCollectionRequest = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(maxDownloadLinkLength)),
  cursor: Schema.optional(CollectionCursor),
});
export type DownloadCollectionRequest = typeof DownloadCollectionRequest.Type;
const CollectionVideo = Schema.Struct({
  ...DownloadSourceDetails.fields,
  url: Schema.String.check(
    Schema.makeFilter((url) => {
      const source = recognizeDownloadSource(url);
      return (
        (source?.site === "youtube" && source.url === url) || "Use a canonical YouTube video URL."
      );
    }),
  ),
});
export const DownloadCollectionPage = Schema.Struct({
  title: Schema.NullOr(DownloadTitle),
  videos: Schema.Array(CollectionVideo).check(Schema.isMaxLength(collectionPageSize)),
  nextCursor: Schema.NullOr(CollectionCursor),
});
export const DownloadJob = Schema.Struct({
  id: MediaId,
  url: Schema.String,
  preset: DownloadPreset,
  transcribe: Schema.Boolean,
  tagIds: Schema.Array(TagId).check(Schema.isMaxLength(maxTags)),
  title: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Number),
  status: Schema.Literals(downloadStates),
  phase: Schema.Literals(["queued", "checking", "downloading", "processing", "saving", "finished"]),
  downloadedBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  totalBytes: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  error: Schema.NullOr(Schema.String),
  cleanupError: Schema.NullOr(Schema.String),
  mediaId: Schema.NullOr(MediaId),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  updatedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type DownloadJob = typeof DownloadJob.Type;
export const DownloadJobList = Schema.Array(DownloadJob);
