import { useEffect, useRef, useState } from "react";
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { MediaItem } from "../../shared/contracts/media.ts";
import {
  downloadsOptions,
  mediaItemOptions,
  mediaListKey,
  transcriptionOptions,
} from "../lib/api.ts";
import type { TranscriptionActionMutation } from "../lib/transcription-actions.ts";
import { copyFailureMessage } from "../lib/transcript-sharing.ts";
import { useRecordingActions } from "./recording-actions.tsx";
import { RenameRecordingDialog } from "./rename-recording-dialog.tsx";
import { Button } from "./ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";

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
  const [renaming, setRenaming] = useState(false);
  const { add: addToast } = Toast.useToastManager();
  const leaveRecording = async () => {
    await navigate({ to: "/", replace: true });
    queryClient.removeQueries({ queryKey: mediaItemOptions(item.id).queryKey, exact: true });
    queryClient.removeQueries({ queryKey: transcriptionOptions(item.id).queryKey, exact: true });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: mediaListKey }),
      queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
    ]);
  };
  const actions = useRecordingActions({
    item,
    transcribe,
    loadTranscription: true,
    returnFocus: trigger,
    onRename: () => setRenaming(true),
    onDeleted: (deletion) => {
      if (!deletion.cleanupError) void leaveRecording();
    },
    deletionNotice: { acknowledge: "Back to library", onAcknowledge: () => void leaveRecording() },
  });
  useEffect(() => {
    if (actions.copyState === "copied") addToast({ title: "Transcript copied" });
    if (actions.copyState === "failed")
      addToast({
        title: "Could not copy transcript",
        description: copyFailureMessage,
        priority: "high",
      });
  }, [actions.copyState, addToast]);
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
      setRenaming(true);
    };
    window.addEventListener("keydown", renameOnF2);
    return () => window.removeEventListener("keydown", renameOnF2);
  }, []);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="More actions"
          disabled={actions.busy}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[236px]">
          {actions.items}
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameRecordingDialog
        item={item}
        open={renaming}
        onOpenChange={setRenaming}
        returnFocus={trigger}
      />
      {actions.dialogs}
    </>
  );
}
