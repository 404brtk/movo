import { Toast } from "@base-ui/react/toast";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LibraryList } from "../../shared/contracts/library.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { Tag, TagColor, TagRef, UpdateTag } from "../../shared/contracts/tags.ts";
import { sortTags } from "../../shared/tag-names.ts";
import { foldSearchText } from "../../shared/search-text.ts";
import {
  askKey,
  changeRecordingTags,
  createTag,
  deleteTag,
  mediaItemOptions,
  mediaListKey,
  mediaRecordingsKey,
  tagsOptions,
  updateTag,
} from "./api.ts";

export const tagColorNames: Record<TagColor, string> = {
  gray: "Gray",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  sky: "Sky",
  indigo: "Indigo",
  purple: "Purple",
  pink: "Pink",
};

export const rowTagNameBudget = 26;
export const maxRowTagNames = 2;

export const showsTagNames = (tags: readonly Pick<TagRef, "name">[]) =>
  tags.length <= maxRowTagNames &&
  tags.reduce((total, tag) => total + tag.name.length, 0) <= rowTagNameBudget;

export const tagCountLabel = (count: number) => (count === 1 ? "1 tag" : `${count} tags`);

export function tagMatchRanges(name: string, query: string) {
  const words = foldSearchText(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  return Array.from(name.matchAll(/\S+/gu)).flatMap((word) => {
    const folded = foldSearchText(word[0]);
    const length = Math.max(
      0,
      ...words.filter((each) => folded.startsWith(each)).map((each) => each.length),
    );
    return length > 0
      ? [{ start: word.index, end: word.index + Math.min(length, word[0].length) }]
      : [];
  });
}

export type TagState = "all" | "some" | "none";

export function bulkTagState(items: readonly Pick<MediaItem, "tags">[], tagId: string) {
  const count = items.filter((item) => item.tags.some((tag) => tag.id === tagId)).length;
  const state: TagState = count === 0 ? "none" : count === items.length ? "all" : "some";
  return { count, state };
}

export const tagRef = ({ id, name, color }: Pick<Tag, "id" | "name" | "color">): TagRef => ({
  id,
  name,
  color,
});

function patchRecordings(
  queryClient: QueryClient,
  change: (item: MediaItem) => MediaItem,
  ids: ReadonlySet<string>,
) {
  queryClient.setQueriesData<LibraryList>(
    { queryKey: mediaListKey },
    (current) =>
      current && {
        ...current,
        items: current.items.map((item) =>
          ids.has(item.id) ? { ...item, ...change(item) } : item,
        ),
      },
  );
  for (const id of ids)
    queryClient.setQueryData(
      mediaItemOptions(id).queryKey,
      (current) => current && change(current),
    );
}

const refreshTaggedRecordings = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: tagsOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: mediaRecordingsKey }),
  ]);

export function useTagEditing() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createTag,
    onSuccess: (tag) => {
      queryClient.setQueryData(tagsOptions.queryKey, (current) =>
        current ? sortTags([...current, tag]) : current,
      );
      void queryClient.invalidateQueries({ queryKey: tagsOptions.queryKey });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, change }: { id: string; change: UpdateTag }) => updateTag(id, change),
    onSuccess: (tag) => {
      queryClient.setQueryData(tagsOptions.queryKey, (current) =>
        current?.map((each) => (each.id === tag.id ? tag : each)),
      );
      void refreshTaggedRecordings(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: deleteTag,
    onSuccess: (tag) => {
      queryClient.setQueryData(tagsOptions.queryKey, (current) =>
        current?.filter((each) => each.id !== tag.id),
      );
      void refreshTaggedRecordings(queryClient);
      void queryClient.invalidateQueries({ queryKey: askKey });
    },
  });
  return { create, update, remove };
}

function useFailureToast() {
  const { add } = Toast.useToastManager();
  return (error: Error) =>
    add({ title: "Could not change tags", description: error.message, priority: "high" });
}

export function useRecordingTags(items: readonly MediaItem[]) {
  const queryClient = useQueryClient();
  const reportFailure = useFailureToast();
  const ids = new Set(items.map((item) => item.id));
  return useMutation({
    mutationFn: (change: { add: readonly TagRef[]; remove: readonly TagRef[] }) =>
      changeRecordingTags({
        mediaIds: [...ids],
        add: change.add.map((tag) => tag.id),
        remove: change.remove.map((tag) => tag.id),
      }),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: mediaListKey });
      const previous = new Map(items.map((item) => [item.id, item.tags]));
      const removed = new Set(change.remove.map((tag) => tag.id));
      patchRecordings(
        queryClient,
        (current) => ({
          ...current,
          tags: sortTags([
            ...current.tags.filter(
              (tag) => !removed.has(tag.id) && !change.add.some((added) => added.id === tag.id),
            ),
            ...change.add,
          ]),
        }),
        ids,
      );
      return { previous };
    },
    onError: (error, _change, context) => {
      if (context)
        patchRecordings(
          queryClient,
          (current) => ({ ...current, tags: context.previous.get(current.id) ?? current.tags }),
          ids,
        );
      reportFailure(error);
    },
    onSettled: () => refreshTaggedRecordings(queryClient),
  });
}
