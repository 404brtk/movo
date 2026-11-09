import { type RefObject, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { mediaItemOptions, mediaListKey, renameMedia } from "../lib/api.ts";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

export function RenameRecordingDialog({
  item,
  open,
  onOpenChange,
  returnFocus,
}: {
  item: MediaItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const title = draft ?? item.title;
  const input = useRef<HTMLInputElement>(null);
  const rename = useMutation({
    mutationFn: () => renameMedia(item.id, title.trim()),
    onMutate: () => queryClient.cancelQueries({ queryKey: mediaListKey }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(mediaItemOptions(item.id).queryKey, updated);
      setDraft(null);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (rename.isPending) return;
        if (!next) {
          setDraft(null);
          rename.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent initialFocus={input} finalFocus={returnFocus} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename recording</DialogTitle>
        </DialogHeader>
        <form
          aria-label="Rename recording"
          onSubmit={(event) => {
            event.preventDefault();
            if (!rename.isPending) rename.mutate();
          }}
        >
          <div className="px-5 pt-3.5">
            <label htmlFor="recording-title" className="mb-1.5 block text-xs font-medium">
              Title
            </label>
            <Input
              id="recording-title"
              name="title"
              ref={input}
              required
              maxLength={512}
              value={title}
              disabled={rename.isPending}
              onChange={(event) => setDraft(event.target.value)}
              aria-invalid={rename.isError || undefined}
              aria-describedby={rename.isError ? "rename-error" : undefined}
            />
            {rename.isError ? (
              <p
                id="rename-error"
                role="alert"
                className="mt-2 text-xs wrap-anywhere text-destructive"
              >
                {rename.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />} disabled={rename.isPending}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              aria-busy={rename.isPending}
              disabled={rename.isPending || !title.trim()}
            >
              {rename.isPending ? <Spinner /> : null}
              {rename.isPending ? "Saving…" : "Save title"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
