import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { ApiError, mediaListKey, transcriptionOptions } from "./api.ts";

export function useTranscriptChange<Request>(
  mediaId: string,
  change: (request: Request) => Promise<TranscriptionJob>,
) {
  const client = useQueryClient();
  const { queryKey } = transcriptionOptions(mediaId);
  return useMutation({
    mutationFn: change,
    onMutate: () => client.cancelQueries({ queryKey, exact: true }),
    onSuccess: async (job) => {
      client.setQueryData(queryKey, job);
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: mediaListKey }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409)
        await client.invalidateQueries({ queryKey });
    },
  });
}
