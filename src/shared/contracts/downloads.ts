import { Schema } from "effect";
import { MediaId } from "./media.ts";

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
export const DownloadPreviewRequest = Schema.Struct({ url: Schema.String });
export const DownloadRequest = Schema.Struct({
  urls: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  preset: Schema.optional(DownloadPreset),
  transcribe: Schema.optional(Schema.Boolean),
});
export type DownloadRequest = typeof DownloadRequest.Type;
export const DownloadPreview = Schema.Struct({
  url: Schema.String,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  durationSeconds: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
});
export type DownloadPreview = typeof DownloadPreview.Type;
export const DownloadJob = Schema.Struct({
  id: MediaId,
  url: Schema.String,
  preset: DownloadPreset,
  transcribe: Schema.Boolean,
  title: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Number),
  status: Schema.Literals(downloadStates),
  phase: Schema.Literals(["queued", "checking", "downloading", "processing", "saving", "finished"]),
  downloadedBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.NullOr(Schema.String),
  cleanupError: Schema.NullOr(Schema.String),
  mediaId: Schema.NullOr(MediaId),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  updatedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type DownloadJob = typeof DownloadJob.Type;
export const DownloadJobList = Schema.Array(DownloadJob);
