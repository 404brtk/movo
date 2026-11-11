import { useState } from "react";
import { Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import {
  deleteMedia,
  downloadsOptions,
  enqueueTranscription,
  mediaListKey,
  retryTranscription,
  transcriptionOptions,
} from "../lib/api.ts";
import {
  type BulkFailure,
  describeBulkDeletion,
  recordingCount,
} from "../lib/library-selection.ts";
import { canStartTranscription } from "../lib/library-view.ts";
import { forgetDeletedRecording } from "../lib/recording-mutations.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { focusRecordingRow, useLibraryManagement } from "./library-management.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";

const failureMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

function useBulkTranscription() {
  const queryClient = useQueryClient();
  const management = useLibraryManagement();
  return useMutation({
    mutationFn: async (targets: readonly LibraryItem[]) => {
      const started: string[] = [];
      try {
        for (const target of targets) {
          await (target.transcription === "stopped"
            ? retryTranscription(target.id)
            : enqueueTranscription(target.id));
          started.push(target.id);
        }
        return { started, failure: null };
      } catch (error) {
        return { started, failure: failureMessage(error) };
      }
    },
    onSuccess: async ({ started }) => {
      management.deselect(started);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mediaListKey }),
        ...started.map((id) =>
          queryClient.invalidateQueries({ queryKey: transcriptionOptions(id).queryKey }),
        ),
      ]);
    },
  });
}

function useBulkDeletion(onFinished: (failures: readonly BulkFailure[]) => void) {
  const queryClient = useQueryClient();
  const management = useLibraryManagement();
  return useMutation({
    mutationFn: async (targets: readonly LibraryItem[]) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: mediaListKey }),
        queryClient.cancelQueries({ queryKey: downloadsOptions.queryKey }),
      ]);
      const failures: BulkFailure[] = [];
      const cleanupErrors: string[] = [];
      for (const target of targets) {
        try {
          const deletion = await deleteMedia(target.id);
          forgetDeletedRecording(queryClient, target.id);
          queryClient.removeQueries({ queryKey: transcriptionOptions(target.id).queryKey });
          if (deletion.cleanupError) cleanupErrors.push(deletion.cleanupError);
        } catch (error) {
          failures.push({ title: target.title, message: failureMessage(error) });
        }
      }
      return { total: targets.length, failures, cleanupErrors };
    },
    onSuccess: async ({ failures, cleanupErrors }) => {
      const [cleanupError] = cleanupErrors;
      if (cleanupError) management.reportCleanup(cleanupError);
      onFinished(failures);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mediaListKey }),
        queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
      ]);
    },
  });
}

export function LibrarySelectionBar() {
  const management = useLibraryManagement();
  const [confirming, setConfirming] = useState(false);
  const transcribable = management.selectedItems.filter(canStartTranscription);
  const transcribe = useBulkTranscription();
  const remove = useBulkDeletion((failures) => {
    if (failures.length > 0) return;
    setConfirming(false);
    focusRecordingRow(null);
  });
  const count = remove.isPending
    ? (remove.variables?.length ?? 0)
    : management.selectedItems.length;
  const deletionError = remove.data?.failures.length
    ? describeBulkDeletion(remove.data.total, remove.data.failures)
    : (remove.error?.message ?? null);
  const one = count === 1;

  return (
    <div className="mt-3">
      <fieldset
        aria-label="Selected recordings"
        className="m-0 flex h-7 min-w-0 animate-in items-center gap-1.5 border-0 p-0 pl-[13px] duration-150 fade-in-0 motion-reduce:animate-none"
      >
        <Checkbox
          aria-label="Select all recordings"
          checked={management.allSelected}
          indeterminate={!management.allSelected}
          onCheckedChange={(checked) => management.setAll(checked)}
        />
        <output
          aria-live="polite"
          className="mr-auto ml-2 text-[13px] font-medium whitespace-nowrap tabular-nums"
        >
          {management.selectedItems.length} selected
        </output>
        {transcribable.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            aria-busy={transcribe.isPending}
            disabled={transcribe.isPending}
            onClick={() => transcribe.mutate(transcribable)}
          >
            {transcribe.isPending ? <Spinner /> : null}
            {transcribe.isPending ? "Starting…" : `Transcribe ${transcribable.length}`}
          </Button>
        ) : null}
        <Button
          variant="destructive"
          size="sm"
          className="max-sm:w-7 max-sm:px-0"
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
          <span className="max-sm:sr-only">Delete…</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1"
          aria-label="Clear selection"
          onClick={management.clear}
        >
          <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
        </Button>
      </fieldset>
      {transcribe.data?.failure ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {transcribe.data.failure}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        icon={Delete02Icon}
        title={`Delete ${recordingCount(count)}?`}
        description={
          one
            ? "This permanently deletes Movo’s saved copy, its transcript and linked download history. Your original imported file stays where it is."
            : "This permanently deletes Movo’s saved copies, their transcripts and linked download history. Your original imported files stay where they are."
        }
        keep={one ? "Keep recording" : "Keep recordings"}
        confirm="Delete permanently"
        pending="Deleting…"
        severity="permanent"
        busy={remove.isPending}
        error={deletionError}
        onConfirm={() => remove.mutate(management.selectedItems)}
      />
    </div>
  );
}
