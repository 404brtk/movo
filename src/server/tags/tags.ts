import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { ChatScope } from "../../shared/contracts/ask.ts";
import type { ChangeRecordingTags, MediaItem } from "../../shared/contracts/media.ts";
import {
  maxTags,
  maxTagsPerRecording,
  TagList,
  type CreateTag,
  type TagRef,
  type UpdateTag,
} from "../../shared/contracts/tags.ts";
import { leastUsedColor, sortTags, tagNameKey } from "../../shared/tag-names.ts";
import { chats } from "../ask/ask.schema.ts";
import type { AppDatabase } from "../db/database.ts";
import { MediaError } from "../media/error.ts";
import { mediaItems } from "../media/media.schema.ts";
import { downloadJobTags, mediaTags, tags } from "./tags.schema.ts";

type TagDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;
type MediaReader = { get: (id: string) => Effect.Effect<MediaItem, MediaError> };

const storage = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof MediaError
        ? cause
        : new MediaError(
            "storage",
            "Could not access tags. Check the database and disk space.",
            cause,
          ),
  });

const missingTag = () => new MediaError("notFound", "This tag no longer exists.");
const duplicateName = (name: string) =>
  new MediaError("conflict", `“${name}” already exists. Choose another name.`);

export function readTagRefs(database: Pick<AppDatabase, "select">, mediaIds: readonly string[]) {
  const refs = new Map<string, TagRef[]>(mediaIds.map((id) => [id, []]));
  if (mediaIds.length === 0) return refs;
  const rows = database
    .select({ mediaId: mediaTags.mediaId, id: tags.id, name: tags.name, color: tags.color })
    .from(mediaTags)
    .innerJoin(tags, eq(tags.id, mediaTags.tagId))
    .where(inArray(mediaTags.mediaId, [...mediaIds]))
    .all();
  for (const { mediaId, ...tag } of rows) refs.get(mediaId)?.push(tag);
  for (const [id, list] of refs) refs.set(id, sortTags(list));
  return refs;
}

export function requireTags(database: Pick<AppDatabase, "select">, tagIds: readonly string[]) {
  if (tagIds.length === 0) return;
  const found = database
    .select({ id: tags.id })
    .from(tags)
    .where(inArray(tags.id, [...tagIds]))
    .all();
  if (found.length !== new Set(tagIds).size) throw missingTag();
}

export function addTagsToRecording(
  database: TagDatabase,
  mediaId: string,
  tagIds: readonly string[],
) {
  const current = new Set(
    database
      .select({ tagId: mediaTags.tagId })
      .from(mediaTags)
      .where(eq(mediaTags.mediaId, mediaId))
      .all()
      .map((row) => row.tagId),
  );
  const existing = new Set(
    tagIds.length === 0
      ? []
      : database
          .select({ id: tags.id })
          .from(tags)
          .where(inArray(tags.id, [...tagIds]))
          .all()
          .map((row) => row.id),
  );
  const added = tagIds
    .filter((id) => existing.has(id) && !current.has(id))
    .slice(0, Math.max(0, maxTagsPerRecording - current.size));
  if (added.length > 0)
    database
      .insert(mediaTags)
      .values(added.map((tagId) => ({ mediaId, tagId })))
      .run();
}

export const readTagNames = (database: Pick<AppDatabase, "select">, tagIds: readonly string[]) =>
  tagIds.length === 0
    ? []
    : sortTags(
        database
          .select({ name: tags.name })
          .from(tags)
          .where(inArray(tags.id, [...tagIds]))
          .all(),
      ).map((tag) => tag.name);

export function readJobTagIds(database: Pick<AppDatabase, "select">, jobIds: readonly string[]) {
  const ids = new Map<string, string[]>(jobIds.map((id) => [id, []]));
  if (jobIds.length === 0) return ids;
  for (const row of database
    .select({ jobId: downloadJobTags.jobId, tagId: downloadJobTags.tagId })
    .from(downloadJobTags)
    .where(inArray(downloadJobTags.jobId, [...jobIds]))
    .all())
    ids.get(row.jobId)?.push(row.tagId);
  return ids;
}

export function addJobTags(database: TagDatabase, jobId: string, tagIds: readonly string[]) {
  if (tagIds.length === 0) return;
  database
    .insert(downloadJobTags)
    .values(tagIds.map((tagId) => ({ jobId, tagId })))
    .onConflictDoNothing()
    .run();
}

const withoutTag = (scope: ChatScope, tagId: string): ChatScope | null => {
  const tagIds = scope.tagIds?.filter((id) => id !== tagId) ?? [];
  if (tagIds.length > 0) return { ...scope, tagIds };
  return scope.kind ? { kind: scope.kind } : null;
};

export function createTags(database: AppDatabase, library: MediaReader) {
  const readTags = () =>
    Schema.decodeUnknownSync(TagList)(
      sortTags(
        database
          .select({
            id: tags.id,
            name: tags.name,
            color: tags.color,
            createdAt: tags.createdAt,
            recordingCount: count(mediaTags.mediaId),
          })
          .from(tags)
          .leftJoin(mediaTags, eq(mediaTags.tagId, tags.id))
          .groupBy(tags.id)
          .all(),
      ),
    );
  const readTag = (id: string) => {
    const tag = readTags().find((candidate) => candidate.id === id);
    if (!tag) throw missingTag();
    return tag;
  };
  const assertNameFree = (name: string, exceptId: string | null) => {
    const taken = database
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.nameKey, tagNameKey(name)), exceptId ? ne(tags.id, exceptId) : undefined))
      .get();
    if (taken) throw duplicateName(name);
  };
  const requireRecordings = (mediaIds: readonly string[]) => {
    const found = database
      .select({ id: mediaItems.id, title: mediaItems.title })
      .from(mediaItems)
      .where(inArray(mediaItems.id, [...mediaIds]))
      .all();
    if (found.length !== mediaIds.length)
      throw new MediaError("notFound", "A chosen recording no longer exists.");
    return new Map(found.map((row) => [row.id, row.title]));
  };
  const readItems = (mediaIds: readonly string[]) =>
    Effect.forEach(mediaIds, (id) => library.get(id));

  const idsForNames = (names: readonly string[]) =>
    storage(() => {
      if (names.length === 0) return [];
      const known = readTags();
      const byKey = new Map(known.map((tag) => [tagNameKey(tag.name), tag.id]));
      return [
        ...new Set(
          names.map((name) => {
            const id = byKey.get(tagNameKey(name.trim()));
            if (id) return id;
            throw new MediaError(
              "notFound",
              known.length === 0
                ? `No tag named “${name}”. The library has no tags yet; create one with create_tag.`
                : `No tag named “${name}”. Tags: ${known.map((tag) => tag.name).join(", ")}.`,
            );
          }),
        ),
      ];
    });

  const idForName = (name: string) =>
    idsForNames([name]).pipe(
      Effect.flatMap(([id]) => (id ? Effect.succeed(id) : Effect.fail(missingTag()))),
    );

  return {
    idsForNames,
    idForName,
    list: () => storage(readTags),
    create: ({ name, color }: CreateTag) =>
      storage(() => {
        const id = randomUUID();
        database.transaction((transaction) => {
          if ((transaction.select({ total: count() }).from(tags).get()?.total ?? 0) >= maxTags)
            throw new MediaError(
              "conflict",
              `The library can have up to ${maxTags} tags. Delete one to add another.`,
            );
          assertNameFree(name, null);
          transaction
            .insert(tags)
            .values({
              id,
              name,
              nameKey: tagNameKey(name),
              color:
                color ??
                leastUsedColor(
                  transaction
                    .select({ color: tags.color })
                    .from(tags)
                    .all()
                    .map((row) => row.color),
                ),
              createdAt: Date.now(),
            })
            .run();
        });
        return readTag(id);
      }),
    update: (id: string, change: UpdateTag) =>
      storage(() => {
        readTag(id);
        if (change.name !== undefined) assertNameFree(change.name, id);
        database
          .update(tags)
          .set({
            ...(change.name === undefined
              ? {}
              : { name: change.name, nameKey: tagNameKey(change.name) }),
            ...(change.color === undefined ? {} : { color: change.color }),
          })
          .where(eq(tags.id, id))
          .run();
        return readTag(id);
      }),
    remove: (id: string) =>
      storage(() => {
        const tag = readTag(id);
        database.transaction((transaction) => {
          for (const chat of transaction
            .select({ id: chats.id, scope: chats.scope })
            .from(chats)
            .where(isNotNull(chats.scope))
            .all())
            if (chat.scope?.tagIds?.includes(id))
              transaction
                .update(chats)
                .set({ scope: withoutTag(chat.scope, id) })
                .where(eq(chats.id, chat.id))
                .run();
          transaction.delete(tags).where(eq(tags.id, id)).run();
        });
        return tag;
      }),
    setForRecording: (mediaId: string, tagIds: readonly string[]) =>
      Effect.gen(function* () {
        yield* library.get(mediaId);
        yield* storage(() =>
          database.transaction((transaction) => {
            requireTags(transaction, tagIds);
            transaction.delete(mediaTags).where(eq(mediaTags.mediaId, mediaId)).run();
            if (tagIds.length > 0)
              transaction
                .insert(mediaTags)
                .values(tagIds.map((tagId) => ({ mediaId, tagId })))
                .run();
          }),
        );
        return yield* library.get(mediaId);
      }),
    change: ({ mediaIds, add, remove }: ChangeRecordingTags) =>
      Effect.gen(function* () {
        yield* storage(() =>
          database.transaction((transaction) => {
            const titles = requireRecordings(mediaIds);
            requireTags(transaction, [...add, ...remove]);
            const current = readTagRefs(transaction, mediaIds);
            for (const mediaId of mediaIds) {
              const ids = new Set(current.get(mediaId)?.map((tag) => tag.id));
              for (const tagId of remove) ids.delete(tagId);
              for (const tagId of add) ids.add(tagId);
              if (ids.size > maxTagsPerRecording)
                throw new MediaError(
                  "conflict",
                  `“${titles.get(mediaId)}” would have more than ${maxTagsPerRecording} tags. Remove some of its tags first.`,
                );
            }
            if (remove.length > 0)
              transaction
                .delete(mediaTags)
                .where(
                  and(
                    inArray(mediaTags.mediaId, [...mediaIds]),
                    inArray(mediaTags.tagId, [...remove]),
                  ),
                )
                .run();
            if (add.length > 0)
              for (const mediaId of mediaIds)
                transaction
                  .insert(mediaTags)
                  .values(add.map((tagId) => ({ mediaId, tagId })))
                  .onConflictDoNothing()
                  .run();
          }),
        );
        return yield* readItems(mediaIds);
      }),
  };
}

export type Tags = ReturnType<typeof createTags>;
