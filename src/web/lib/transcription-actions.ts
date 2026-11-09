import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import {
  cancelTranscription,
  enqueueTranscription,
  mediaListKey,
  retryTranscription,
  transcriptionOptions,
} from "./api.ts";

export const isActiveTranscription = (job: TranscriptionJob | null | undefined) =>
  job?.status === "queued" || job?.status === "running";

export type TranscriptionAction = "start" | "cancel" | "retry";

export function useTranscriptionAction(mediaId: string) {
  const queryClient = useQueryClient();
  const { queryKey } = transcriptionOptions(mediaId);
  return useMutation({
    mutationKey: ["transcription-action", mediaId],
    mutationFn: (action: TranscriptionAction) =>
      action === "start"
        ? enqueueTranscription(mediaId)
        : action === "cancel"
          ? cancelTranscription(mediaId)
          : retryTranscription(mediaId),
    onMutate: () => queryClient.cancelQueries({ queryKey, exact: true }),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKey, job);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: mediaListKey }),
      ]),
  });
}
