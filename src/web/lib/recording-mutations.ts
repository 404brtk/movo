import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LibraryList } from "../../shared/contracts/library.ts";
import type { MediaDeletion, MediaItem } from "../../shared/contracts/media.ts";
import {
  deleteMedia,
  downloadsOptions,
  mediaItemOptions,
  mediaListKey,
  removeMediaFile,
  renameMedia,
  transcriptionOptions,
} from "./api.ts";

export function forgetDeletedRecording(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<LibraryList>(
    { queryKey: mediaListKey },
    (current) => current && { ...current, items: current.items.filter((entry) => entry.id !== id) },
  );
}

export function useRenameRecording(item: MediaItem) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => renameMedia(item.id, title),
    onMutate: () => queryClient.cancelQueries({ queryKey: mediaListKey }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(mediaItemOptions(item.id).queryKey, updated);
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });
}

export function useDeleteRecording(
  item: MediaItem,
  onDeleted: (deletion: MediaDeletion) => void | Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteMedia(item.id),
    onMutate: () =>
      Promise.all([
        queryClient.cancelQueries({ queryKey: mediaListKey }),
        queryClient.cancelQueries({ queryKey: transcriptionOptions(item.id).queryKey }),
        queryClient.cancelQueries({ queryKey: downloadsOptions.queryKey }),
      ]),
    onSuccess: async (deletion) => {
      forgetDeletedRecording(queryClient, item.id);
      await onDeleted(deletion);
    },
  });
}

export function useRemoveSavedCopy(item: MediaItem) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeMediaFile(item.id),
    onMutate: () => queryClient.cancelQueries({ queryKey: mediaListKey }),
    onSuccess: async ({ fileRemovedAt }) => {
      queryClient.setQueryData(
        mediaItemOptions(item.id).queryKey,
        (current) => current && { ...current, fileRemovedAt },
      );
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });
}
