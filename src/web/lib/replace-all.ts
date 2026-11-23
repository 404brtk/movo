import { Toast } from "@base-ui/react/toast";
import type { TranscriptionJob, TranscriptReplace } from "../../shared/contracts/transcriptions.ts";
import { readTranscriptChanges, replaceInTranscript, restoreTranscript } from "./api.ts";
import { useTranscriptChange } from "./transcript-change.ts";

async function undoReplacement(mediaId: string, replaced: TranscriptionJob) {
  const { changes } = await readTranscriptChanges(mediaId, { limit: 2, offset: 0 });
  return restoreTranscript(mediaId, {
    revision: replaced.revision,
    target: changes[1]?.revision ?? replaced.resultRevision,
  });
}

export function useReplaceAll(mediaId: string) {
  const { add: addToast } = Toast.useToastManager();
  const replace = useTranscriptChange(mediaId, (request: TranscriptReplace) =>
    replaceInTranscript(mediaId, request),
  );
  const undo = useTranscriptChange(mediaId, (replaced: TranscriptionJob) =>
    undoReplacement(mediaId, replaced),
  );
  const undoLater = (replaced: TranscriptionJob) =>
    undo.mutate(replaced, {
      onError: (error) =>
        addToast({
          title: "Could not undo the replacement",
          description: error.message,
          priority: "high",
        }),
    });
  return {
    pending: replace.isPending,
    error: replace.error,
    replaceAll: (request: TranscriptReplace, notice: { title: string; description?: string }) =>
      replace.mutate(request, {
        onSuccess: (replaced) =>
          addToast({
            ...notice,
            actionProps: { children: "Undo", onClick: () => undoLater(replaced) },
          }),
      }),
  };
}

export type ReplaceAll = ReturnType<typeof useReplaceAll>;
