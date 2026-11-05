import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import {
  deleteMedia,
  downloadsOptions,
  mediaItemOptions,
  mediaListOptions,
  renameMedia,
  transcriptionOptions,
} from "../lib/api.ts";
import { Button } from "./ui/button.tsx";

export function MediaActions({ item }: { item: MediaItem }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [confirming, setConfirming] = useState(false);
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const focusTitle = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const focusCompletion = useCallback((button: HTMLButtonElement | null) => button?.focus(), []);
  const rename = useMutation({
    mutationFn: () => renameMedia(item.id, title.trim()),
    onMutate: () => client.cancelQueries({ queryKey: mediaListOptions.queryKey }),
    onSuccess: async (updated) => {
      client.setQueryData(mediaItemOptions(item.id).queryKey, updated);
      client.setQueryData(mediaListOptions.queryKey, (current) =>
        current?.map((entry) => (entry.id === item.id ? updated : entry)),
      );
      setEditing(false);
      renameTrigger.current?.focus();
      await client.invalidateQueries({ queryKey: mediaListOptions.queryKey, exact: true });
    },
  });
  const leaveRecording = async () => {
    await navigate({ to: "/", replace: true });
    client.removeQueries({ queryKey: mediaItemOptions(item.id).queryKey, exact: true });
    client.removeQueries({ queryKey: transcriptionOptions(item.id).queryKey, exact: true });
    await Promise.all([
      client.invalidateQueries({ queryKey: mediaListOptions.queryKey, exact: true }),
      client.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
    ]);
  };
  const remove = useMutation({
    mutationFn: () => deleteMedia(item.id),
    onMutate: async () => {
      await Promise.all([
        client.cancelQueries({ queryKey: mediaListOptions.queryKey }),
        client.cancelQueries({ queryKey: transcriptionOptions(item.id).queryKey }),
        client.cancelQueries({ queryKey: downloadsOptions.queryKey }),
      ]);
    },
    onSuccess: async (deleted) => {
      client.setQueryData(mediaListOptions.queryKey, (current) =>
        current?.filter((entry) => entry.id !== item.id),
      );
      if (!deleted.cleanupError) await leaveRecording();
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          ref={renameTrigger}
          variant="outline"
          className="h-10 px-3 text-sm"
          disabled={remove.isPending}
          aria-expanded={editing}
          onClick={() => {
            if (rename.isPending) return;
            setTitle(item.title);
            rename.reset();
            setEditing(true);
          }}
        >
          Rename
        </Button>
        <AlertDialog.Root
          open={confirming}
          onOpenChange={(open) => {
            if (remove.isPending) return;
            if (!open && remove.data?.cleanupError) {
              void leaveRecording();
              return;
            }
            remove.reset();
            setConfirming(open);
          }}
        >
          <AlertDialog.Trigger
            render={<Button variant="destructive" className="h-10 px-3 text-sm" />}
            disabled={editing}
          >
            Delete recording
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
            <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-5 overflow-y-auto rounded-xl border bg-background p-6 shadow-lg">
              <AlertDialog.Title className="text-xl font-semibold wrap-anywhere">
                {remove.data?.cleanupError ? "Recording deleted" : `Delete “${item.title}”?`}
              </AlertDialog.Title>
              <AlertDialog.Description
                aria-live="polite"
                className="text-sm leading-6 text-muted-foreground"
              >
                {remove.data?.cleanupError ??
                  "This permanently deletes Movo’s saved copy, its transcript and linked download history. Your original imported file stays where it is."}
              </AlertDialog.Description>
              {remove.isError ? (
                <p role="alert" className="text-sm wrap-anywhere text-destructive">
                  {remove.error.message}
                </p>
              ) : null}
              {remove.data?.cleanupError ? (
                <Button
                  ref={focusCompletion}
                  className="h-10 px-3 text-sm"
                  onClick={() => {
                    void leaveRecording();
                  }}
                >
                  Back to library
                </Button>
              ) : (
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialog.Close
                    render={<Button variant="outline" className="h-10 px-3 text-sm" />}
                    disabled={remove.isPending}
                  >
                    Keep recording
                  </AlertDialog.Close>
                  <Button
                    variant="destructive"
                    className="h-10 px-3 text-sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? "Deleting…" : "Delete permanently"}
                  </Button>
                </div>
              )}
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
      {editing ? (
        <form
          aria-label="Rename recording"
          className="space-y-3 rounded-xl border p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!rename.isPending) rename.mutate();
          }}
        >
          <label htmlFor="recording-title" className="block text-sm font-medium">
            Title
          </label>
          <input
            ref={focusTitle}
            id="recording-title"
            name="title"
            required
            maxLength={512}
            value={title}
            disabled={rename.isPending}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={rename.isError || undefined}
            aria-describedby={rename.isError ? "rename-error" : undefined}
            className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          {rename.isError ? (
            <p id="rename-error" role="alert" className="text-sm wrap-anywhere text-destructive">
              {rename.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              className="h-10 px-3 text-sm"
              disabled={rename.isPending || !title.trim()}
            >
              {rename.isPending ? "Saving…" : "Save title"}
            </Button>
            <Button
              variant="outline"
              className="h-10 px-3 text-sm"
              disabled={rename.isPending}
              onClick={() => {
                setEditing(false);
                renameTrigger.current?.focus();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
