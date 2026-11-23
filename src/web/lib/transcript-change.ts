import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { ApiError, mediaListKey, transcriptionOptions } from "./api.ts";

export function useTranscriptChange<Request>(
  mediaId: string,
  change: (request: Request) => Promise<TranscriptionJob>,
  outcome: {
    onSuccess?: (job: TranscriptionJob, request: Request) => void;
    onError?: (error: Error, request: Request) => void;
  } = {},
) {
  const client = useQueryClient();
  const { queryKey } = transcriptionOptions(mediaId);
  return useMutation({
    mutationFn: change,
    onMutate: () => client.cancelQueries({ queryKey, exact: true }),
    onSuccess: async (job, request) => {
      client.setQueryData(queryKey, job);
      outcome.onSuccess?.(job, request);
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: mediaListKey }),
      ]);
    },
    onError: async (error, request) => {
      outcome.onError?.(error, request);
      if (error instanceof ApiError && error.status === 409)
        await client.invalidateQueries({ queryKey });
    },
  });
}
