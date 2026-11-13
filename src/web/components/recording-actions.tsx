import { type RefObject, useState } from "react";
import {
  ArrowUpRight01Icon,
  CheckmarkSquare02Icon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  FileExportIcon,
  FileRemoveIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import type { MediaDeletion, MediaItem } from "../../shared/contracts/media.ts";
import { mediaFileUrl, transcriptionOptions } from "../lib/api.ts";
import { useDeleteRecording, useRemoveSavedCopy } from "../lib/recording-mutations.ts";
import { useCopyTranscript } from "../lib/transcript-sharing.ts";
import {
  hasEdits,
  isActiveTranscription,
  type TranscriptionActionMutation,
} from "../lib/transcription-actions.ts";
import { CleanupNotice, ConfirmDialog, ReplaceEditsDialog } from "./confirm-dialog.tsx";
import { Spinner } from "./spinner.tsx";
import { TranscriptExportItems } from "./transcript-actions.tsx";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./ui/dropdown-menu.tsx";

type RecordingDialog = "retranscribe" | "remove-file" | "delete";

type LibraryActions = {
  onSelect: () => void;
};

function MenuIcon({ icon }: { icon: IconSvgElement }) {
  return <HugeiconsIcon icon={icon} aria-hidden="true" className="text-muted-foreground" />;
}

function KeyHint({ children }: { children: string }) {
  return (
    <DropdownMenuShortcut aria-hidden="true" className="pointer-coarse:hidden">
      {children}
    </DropdownMenuShortcut>
  );
}

export function useRecordingActions({
  item,
  transcribe,
  loadTranscription,
  returnFocus,
  onRename,
  onDeleted,
  deletionNotice,
  library,
}: {
  item: MediaItem;
  transcribe: TranscriptionActionMutation;
  loadTranscription: boolean;
  returnFocus: RefObject<HTMLElement | null> | false;
  onRename: () => void;
  onDeleted: (deletion: MediaDeletion) => void;
  deletionNotice?: { acknowledge: string; onAcknowledge: () => void };
  library?: LibraryActions;
}) {
  const [dialog, setDialog] = useState<RecordingDialog | null>(null);
  const transcription = useQuery({ ...transcriptionOptions(item.id), enabled: loadTranscription });
  const job = transcription.data;
  const transcript = job?.transcript ?? null;
  const fileAvailable = item.fileRemovedAt === null;
  const edited = job ? hasEdits(job) : false;
  const hasWords = (transcript?.words.length ?? 0) > 0;
  const copy = useCopyTranscript(transcript);
  const remove = useDeleteRecording(item, (deletion) => {
    setDialog(null);
    onDeleted(deletion);
  });
  const removeFile = useRemoveSavedCopy(item);
  const canReplaceTranscript = fileAvailable && transcript !== null && !isActiveTranscription(job);
  const openDialog = (next: RecordingDialog) => () => {
    remove.reset();
    removeFile.reset();
    setDialog(next);
  };
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const focusAfterDialog = (cleanupError: string | undefined) =>
    cleanupError ? false : returnFocus;

  const items = (
    <>
      <DropdownMenuItem aria-keyshortcuts="F2" onClick={onRename}>
        <MenuIcon icon={Edit02Icon} />
        Rename recording
        <KeyHint>F2</KeyHint>
      </DropdownMenuItem>
      {transcription.isPending && loadTranscription ? (
        <DropdownMenuItem disabled>
          <Spinner />
          Checking the transcript…
        </DropdownMenuItem>
      ) : null}
      {hasWords ? (
        <>
          <DropdownMenuItem
            disabled={copy.state === "copying"}
            onClick={() => void copy.copyText()}
          >
            <MenuIcon icon={Copy01Icon} />
            Copy transcript
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <MenuIcon icon={FileExportIcon} />
              Export transcript
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <TranscriptExportItems mediaId={item.id} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ) : null}
      {fileAvailable ? (
        <DropdownMenuItem
          render={({ children, ...props }) => (
            <a {...props} href={mediaFileUrl(item.id)} download={item.originalName}>
              {children}
            </a>
          )}
        >
          <MenuIcon icon={Download04Icon} />
          Save a copy
        </DropdownMenuItem>
      ) : null}
      {item.sourceUrl ? (
        <DropdownMenuItem
          render={({ children, ...props }) => (
            <a {...props} href={item.sourceUrl ?? undefined} target="_blank" rel="noreferrer">
              {children}
            </a>
          )}
        >
          <MenuIcon icon={ArrowUpRight01Icon} />
          View original source
        </DropdownMenuItem>
      ) : null}
      {canReplaceTranscript ? (
        <DropdownMenuItem
          disabled={transcribe.isPending}
          onClick={edited ? openDialog("retranscribe") : () => transcribe.mutate("retry")}
        >
          <MenuIcon icon={RefreshIcon} />
          {edited ? "Transcribe again…" : "Transcribe again"}
        </DropdownMenuItem>
      ) : null}
      {library ? (
        <DropdownMenuItem onClick={library.onSelect}>
          <MenuIcon icon={CheckmarkSquare02Icon} />
          Select
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {canReplaceTranscript && (hasWords || edited) ? (
        <DropdownMenuItem onClick={openDialog("remove-file")}>
          <MenuIcon icon={FileRemoveIcon} />
          Remove saved copy…
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        variant="destructive"
        aria-keyshortcuts={library ? "Delete" : undefined}
        onClick={openDialog("delete")}
      >
        <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
        Delete recording…
        {library ? <KeyHint>Del</KeyHint> : null}
      </DropdownMenuItem>
    </>
  );

  const dialogs = (
    <>
      <ReplaceEditsDialog
        open={dialog === "retranscribe"}
        onOpenChange={closeDialog}
        returnFocus={returnFocus || undefined}
        transcribe={transcribe}
      />
      <ConfirmDialog
        open={dialog === "remove-file"}
        onOpenChange={closeDialog}
        returnFocus={focusAfterDialog(removeFile.data?.cleanupError)}
        icon={FileRemoveIcon}
        title={`Remove the saved copy of “${item.title}”?`}
        description="This permanently deletes Movo’s saved copy to free up space. The transcript and its exports stay available, but playback and transcribing again will not. Your original imported file stays where it is."
        keep="Keep saved copy"
        confirm="Remove saved copy"
        pending="Removing…"
        busy={removeFile.isPending}
        error={removeFile.error?.message ?? null}
        onConfirm={() => removeFile.mutate(undefined, { onSuccess: () => setDialog(null) })}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={closeDialog}
        returnFocus={focusAfterDialog(remove.data?.cleanupError)}
        icon={Delete02Icon}
        title={`Delete “${item.title}”?`}
        description="This permanently deletes Movo’s saved copy, its transcript and linked download history. Your original imported file stays where it is."
        keep="Keep recording"
        confirm="Delete permanently"
        pending="Deleting…"
        severity="permanent"
        busy={remove.isPending}
        error={remove.error?.message ?? null}
        onConfirm={() => remove.mutate()}
      />
      <CleanupNotice
        cleanupError={removeFile.data?.cleanupError}
        title="Saved copy removed"
        acknowledge="Close"
        onAcknowledge={() => removeFile.reset()}
      />
      {deletionNotice ? (
        <CleanupNotice
          cleanupError={remove.data?.cleanupError}
          title="Recording deleted"
          acknowledge={deletionNotice.acknowledge}
          onAcknowledge={deletionNotice.onAcknowledge}
        />
      ) : null}
    </>
  );

  return {
    items,
    dialogs,
    copyState: copy.state,
    busy: remove.isPending || removeFile.isPending,
    confirmDelete: openDialog("delete"),
  };
}
