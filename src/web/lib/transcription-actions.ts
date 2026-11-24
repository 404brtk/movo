import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelId } from "../../shared/contracts/models.ts";
import type {
  TranscriptionDevice,
  TranscriptionJob,
  TranscriptionRetry,
} from "../../shared/contracts/transcriptions.ts";
import {
  cancelTranscription,
  enqueueTranscription,
  mediaListKey,
  modelsOptions,
  retryTranscription,
  transcriptionOptions,
} from "./api.ts";
import { formatDevice } from "./format.ts";

export const isActiveTranscription = (job: TranscriptionJob | null | undefined) =>
  job?.status === "queued" || job?.status === "running";

export type TranscriptionAction = "start" | "cancel" | "retry" | TranscriptionRetry;

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
          : retryTranscription(mediaId, action === "retry" ? undefined : action),
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

export type TranscriptionActionMutation = ReturnType<typeof useTranscriptionAction>;

export const hasEdits = (job: TranscriptionJob) => job.revision > job.resultRevision;

function useModelNames() {
  const models = useQuery(modelsOptions);
  return (modelId: ModelId) => models.data?.models.find((model) => model.id === modelId)?.name;
}

export function useResultDescription() {
  const modelName = useModelNames();
  return (job: TranscriptionJob, { devices = false } = {}) => {
    const onDevice = (device: TranscriptionDevice | null) =>
      devices && device ? ` on ${formatDevice(device)}` : "";
    const transcribed = `Transcribed by ${modelName(job.modelId) ?? job.modelId}${onDevice(job.resultDevice)}`;
    const speakers = job.resultSpeakerModelId;
    return speakers
      ? `${transcribed} · Speakers by ${modelName(speakers) ?? speakers}${onDevice(job.resultSpeakerDevice)}`
      : transcribed;
  };
}
