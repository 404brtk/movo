import { Schema } from "effect";
import { MediaId } from "./media.ts";

export const downloadStates = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const DownloadRequest = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
});
export const DownloadPreview = Schema.Struct({
  url: Schema.String,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  durationSeconds: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
});
export type DownloadPreview = typeof DownloadPreview.Type;
export const DownloadJob = Schema.Struct({
  id: MediaId,
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Number),
  status: Schema.Literals(downloadStates),
  phase: Schema.Literals(["queued", "checking", "downloading", "processing", "saving", "finished"]),
  downloadedBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.NullOr(Schema.String),
  mediaId: Schema.NullOr(MediaId),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  updatedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type DownloadJob = typeof DownloadJob.Type;
export const DownloadJobList = Schema.Array(DownloadJob);
