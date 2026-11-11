import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight01Icon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  FileRemoveIcon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { LibraryList } from "../../shared/contracts/library.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import {
  deleteMedia,
  downloadsOptions,
  mediaFileUrl,
  mediaItemOptions,
  mediaListKey,
  removeMediaFile,
  transcriptionOptions,
} from "../lib/api.ts";
import {
  hasEdits,
  isActiveTranscription,
  type TranscriptionActionMutation,
} from "../lib/transcription-actions.ts";
import { CleanupNotice, ConfirmDialog, ReplaceEditsDialog } from "./confirm-dialog.tsx";
import { RenameRecordingDialog } from "./rename-recording-dialog.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

type RecordingDialog = "rename" | "retranscribe" | "remove-file" | "delete";

function MenuIcon({ icon }: { icon: IconSvgElement }) {
  return <HugeiconsIcon icon={icon} aria-hidden="true" className="text-muted-foreground" />;
}

export function RecordingMenu({
  item,
  transcribe,
}: {
  item: MediaItem;
  transcribe: TranscriptionActionMutation;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<RecordingDialog | null>(null);
  const transcription = useQuery(transcriptionOptions(item.id));
  const job = transcription.data;
  const fileAvailable = item.fileRemovedAt === null;
  const edited = job ? hasEdits(job) : false;
  const leaveRecording = async () => {
    await navigate({ to: "/", replace: true });
    queryClient.removeQueries({ queryKey: mediaItemOptions(item.id).queryKey, exact: true });
    queryClient.removeQueries({ queryKey: transcriptionOptions(item.id).queryKey, exact: true });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: mediaListKey }),
      queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
    ]);
  };
  const remove = useMutation({
    mutationFn: () => deleteMedia(item.id),
    onMutate: () =>
      Promise.all([
        queryClient.cancelQueries({ queryKey: mediaListKey }),
        queryClient.cancelQueries({ queryKey: transcriptionOptions(item.id).queryKey }),
        queryClient.cancelQueries({ queryKey: downloadsOptions.queryKey }),
      ]),
    onSuccess: async (deleted) => {
      queryClient.setQueriesData<LibraryList>(
        { queryKey: mediaListKey },
        (current) =>
          current && { ...current, items: current.items.filter((entry) => entry.id !== item.id) },
      );
      setDialog(null);
      if (!deleted.cleanupError) await leaveRecording();
    },
  });
  const removeFile = useMutation({
    mutationFn: () => removeMediaFile(item.id),
    onMutate: () => queryClient.cancelQueries({ queryKey: mediaListKey }),
    onSuccess: async ({ fileRemovedAt }) => {
      queryClient.setQueryData(mediaItemOptions(item.id).queryKey, { ...item, fileRemovedAt });
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });
  const canReplaceTranscript =
    fileAvailable && job?.transcript != null && !isActiveTranscription(job);
  const openDialog = (next: RecordingDialog) => () => {
    remove.reset();
    removeFile.reset();
    setDialog(next);
  };
  useEffect(() => {
    const renameOnF2 = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "F2" ||
        event.defaultPrevented ||
        (target instanceof HTMLElement &&
          target.closest("input, textarea, [role=dialog], [role=alertdialog]"))
      )
        return;
      event.preventDefault();
      setDialog("rename");
    };
    window.addEventListener("keydown", renameOnF2);
    return () => window.removeEventListener("keydown", renameOnF2);
  }, []);
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="More actions"
          disabled={remove.isPending || removeFile.isPending}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[236px]">
          <DropdownMenuItem aria-keyshortcuts="F2" onClick={openDialog("rename")}>
            <MenuIcon icon={Edit02Icon} />
            Rename recording
            <DropdownMenuShortcut aria-hidden="true" className="pointer-coarse:hidden">
              F2
            </DropdownMenuShortcut>
          </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          {canReplaceTranscript && (job.transcript.words.length > 0 || edited) ? (
            <DropdownMenuItem onClick={openDialog("remove-file")}>
              <MenuIcon icon={FileRemoveIcon} />
              Remove saved copy…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem variant="destructive" onClick={openDialog("delete")}>
            <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
            Delete recording…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameRecordingDialog
        item={item}
        open={dialog === "rename"}
        onOpenChange={closeDialog}
        returnFocus={trigger}
      />
      <ReplaceEditsDialog
        open={dialog === "retranscribe"}
        onOpenChange={closeDialog}
        returnFocus={trigger}
        transcribe={transcribe}
      />
      <ConfirmDialog
        open={dialog === "remove-file"}
        onOpenChange={closeDialog}
        returnFocus={removeFile.data?.cleanupError ? false : trigger}
        icon={FileRemoveIcon}
        title={`Remove the saved copy of “${item.title}”?`}
        description="This permanently deletes Movo’s saved copy to free up space. The transcript and its exports stay available, but playback and transcribing again will not. Your original imported file stays where it is."
        keep="Keep saved copy"
        confirm="Remove saved copy"
        pending="Removing…"
        busy={removeFile.isPending}
        error={removeFile.error?.message ?? null}
        onConfirm={() => removeFile.mutate()}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={closeDialog}
        returnFocus={remove.data?.cleanupError ? false : trigger}
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
      <CleanupNotice
        cleanupError={remove.data?.cleanupError}
        title="Recording deleted"
        acknowledge="Back to library"
        onAcknowledge={() => void leaveRecording()}
      />
    </>
  );
}
