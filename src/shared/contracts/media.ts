import { Schema } from "effect";

export const maxImportBytes = 10 * 1024 * 1024 * 1024;
export const mediaContentTypes = [
  "video/mp4",
  "audio/mp4",
  "video/webm",
  "audio/webm",
  "video/x-matroska",
  "audio/x-matroska",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/ogg",
  "audio/flac",
  "audio/aac",
] as const;

export const mediaKinds = ["audio", "video"] as const;

export const MediaId = Schema.String.check(Schema.isUUID(4));
export const MediaFileName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^[^\p{Cc}/\\]+$/u),
);
export const MediaContentType = Schema.Literals(mediaContentTypes);
export const MediaTitle = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^[^\p{Cc}]+$/u),
);
export const RenameMediaRequest = Schema.Struct({ title: MediaTitle });
export const MediaItem = Schema.Struct({
  id: MediaId,
  title: Schema.String.check(Schema.isMinLength(1)),
  originalName: MediaFileName,
  kind: Schema.Literals(mediaKinds),
  contentType: MediaContentType,
  byteSize: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: maxImportBytes }),
  ),
  durationSeconds: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  importedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  sourceUrl: Schema.NullOr(Schema.String),
});
export type MediaItem = typeof MediaItem.Type;
export const MediaDeletion = Schema.Struct({
  ...MediaItem.fields,
  cleanupError: Schema.optional(Schema.String),
});
export type MediaDeletion = typeof MediaDeletion.Type;
export const MediaList = Schema.Array(MediaItem);
export const ApiErrorResponse = Schema.Struct({ error: Schema.String });
