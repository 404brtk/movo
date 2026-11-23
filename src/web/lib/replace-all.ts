import type { TranscriptionJob, TranscriptReplace } from "../../shared/contracts/transcriptions.ts";
import { readTranscriptChanges, replaceInTranscript, restoreTranscript } from "./api.ts";
import { toastManager } from "./toasts.ts";
import { useTranscriptChange } from "./transcript-change.ts";

interface Replacement {
  request: TranscriptReplace;
  notice: { title: string; description?: string };
}

async function undoReplacement(mediaId: string, replaced: TranscriptionJob) {
  const { changes } = await readTranscriptChanges(mediaId, { limit: 2, offset: 0 });
  return restoreTranscript(mediaId, {
    revision: replaced.revision,
    target: changes[1]?.revision ?? replaced.resultRevision,
  });
}

export function useReplaceAll(mediaId: string) {
  const undo = useTranscriptChange(
    mediaId,
    (replaced: TranscriptionJob) => undoReplacement(mediaId, replaced),
    {
      onError: (error) =>
        toastManager.add({
          title: "Could not undo the replacement",
          description: error.message,
          priority: "high",
        }),
    },
  );
  const replace = useTranscriptChange(
    mediaId,
    ({ request }: Replacement) => replaceInTranscript(mediaId, request),
    {
      onError: (error) =>
        toastManager.add({
          title: "Could not replace matches",
          description: error.message,
          priority: "high",
        }),
      onSuccess: (replaced, { notice }) =>
        toastManager.add({
          ...notice,
          actionProps: { children: "Undo", onClick: () => undo.mutate(replaced) },
        }),
    },
  );
  return {
    pending: replace.isPending,
    replaceAll: (replacement: Replacement) => replace.mutate(replacement),
  };
}

export type ReplaceAll = ReturnType<typeof useReplaceAll>;
