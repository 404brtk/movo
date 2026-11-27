import { Schema } from "effect";

export const tagColors = [
  "gray",
  "amber",
  "green",
  "teal",
  "sky",
  "indigo",
  "purple",
  "pink",
] as const;
export const TagColor = Schema.Literals(tagColors);
export type TagColor = typeof TagColor.Type;

export const maxTagNameCharacters = 64;
export const maxTagsPerRecording = 20;
export const maxTags = 500;
export const maxTaggedRecordings = 1000;

export const TagId = Schema.String.check(Schema.isUUID(4));

export const TagName = Schema.String.check(
  Schema.makeFilter((name) => name.trim().length > 0 || "Enter a tag name."),
  Schema.makeFilter((name) => name === name.trim() || "Remove spaces around the tag name."),
  Schema.isMaxLength(maxTagNameCharacters),
  Schema.makeFilter(
    (name) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name) || "Keep the tag name on one line.",
  ),
);

export const TagIds = Schema.Array(TagId).check(
  Schema.isMaxLength(maxTagsPerRecording),
  Schema.makeFilter((ids) => new Set(ids).size === ids.length || "List each tag once."),
);

export const TagRef = Schema.Struct({ id: TagId, name: Schema.String, color: TagColor });
export type TagRef = typeof TagRef.Type;

export const Tag = Schema.Struct({
  ...TagRef.fields,
  recordingCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type Tag = typeof Tag.Type;
export const TagList = Schema.Array(Tag);

export const CreateTag = Schema.Struct({ name: TagName, color: Schema.optional(TagColor) });
export type CreateTag = typeof CreateTag.Type;

export const UpdateTag = Schema.Struct({
  name: Schema.optional(TagName),
  color: Schema.optional(TagColor),
}).check(
  Schema.makeFilter(
    (change) =>
      change.name !== undefined || change.color !== undefined || "Change a name or colour.",
  ),
);
export type UpdateTag = typeof UpdateTag.Type;

export const tagIdsIn = (list: string | undefined) => (list ? list.split(",") : []);
export const tagIdList = (ids: readonly string[]) => (ids.length > 0 ? ids.join(",") : undefined);
export const TagIdList = Schema.String.check(
  Schema.makeFilter(
    (list) =>
      (list.length > 0 && Schema.is(TagIds)(tagIdsIn(list))) ||
      `List up to ${maxTagsPerRecording} different tag IDs separated by commas.`,
  ),
);
