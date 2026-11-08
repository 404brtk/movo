import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import type { LibraryList } from "../../shared/contracts/library.ts";
import type { MediaDeletion, MediaItem } from "../../shared/contracts/media.ts";
import {
  deleteMedia,
  downloadsOptions,
  mediaItemOptions,
  mediaListKey,
  removeMediaFile,
  renameMedia,
  transcriptionOptions,
} from "../lib/api.ts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export function MediaActions({ item }: { item: MediaItem }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const focusTitle = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const rename = useMutation({
    mutationFn: () => renameMedia(item.id, title.trim()),
    onMutate: () => client.cancelQueries({ queryKey: mediaListKey }),
    onSuccess: async (updated) => {
      client.setQueryData(mediaItemOptions(item.id).queryKey, updated);
      setEditing(false);
      renameTrigger.current?.focus();
      await client.invalidateQueries({ queryKey: mediaListKey });
    },
  });
  const leaveRecording = async () => {
    await navigate({ to: "/", replace: true });
    client.removeQueries({ queryKey: mediaItemOptions(item.id).queryKey, exact: true });
    client.removeQueries({ queryKey: transcriptionOptions(item.id).queryKey, exact: true });
    await Promise.all([
      client.invalidateQueries({ queryKey: mediaListKey }),
      client.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
    ]);
  };
  const remove = useMutation({
    mutationFn: () => deleteMedia(item.id),
    onMutate: async () => {
      await Promise.all([
        client.cancelQueries({ queryKey: mediaListKey }),
        client.cancelQueries({ queryKey: transcriptionOptions(item.id).queryKey }),
        client.cancelQueries({ queryKey: downloadsOptions.queryKey }),
      ]);
    },
    onSuccess: async (deleted) => {
      client.setQueriesData<LibraryList>(
        { queryKey: mediaListKey },
        (current) =>
          current && {
            ...current,
            items: current.items.filter((entry) => entry.id !== item.id),
          },
      );
      if (!deleted.cleanupError) await leaveRecording();
    },
  });
  const transcription = useQuery(transcriptionOptions(item.id));
  const canRemoveFile =
    item.fileRemovedAt === null &&
    transcription.data?.transcript != null &&
    !["queued", "running"].includes(transcription.data.status);
  const removeFile = useMutation({
    mutationFn: () => removeMediaFile(item.id),
    onMutate: () => client.cancelQueries({ queryKey: mediaListKey }),
    onSuccess: async ({ fileRemovedAt }) => {
      client.setQueryData(mediaItemOptions(item.id).queryKey, { ...item, fileRemovedAt });
      await client.invalidateQueries({ queryKey: mediaListKey });
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          ref={renameTrigger}
          variant="outline"
          className="h-10 px-3 text-sm"
          disabled={remove.isPending || removeFile.isPending}
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
        {canRemoveFile || removeFile.isSuccess ? (
          <ConfirmRemoval
            removal={removeFile}
            disabled={editing || remove.isPending}
            trigger="Remove saved copy"
            title={`Remove the saved copy of “${item.title}”?`}
            description="This permanently deletes Movo’s saved copy to free up space. The transcript and its exports stay available, but playback and transcribing again will not. Your original imported file stays where it is."
            keep="Keep saved copy"
            confirm="Remove saved copy"
            pending="Removing…"
            completed="Saved copy removed"
            onAcknowledge={() => removeFile.reset()}
          />
        ) : null}
        <ConfirmRemoval
          removal={remove}
          disabled={editing || removeFile.isPending}
          trigger="Delete recording"
          title={`Delete “${item.title}”?`}
          description="This permanently deletes Movo’s saved copy, its transcript and linked download history. Your original imported file stays where it is."
          keep="Keep recording"
          confirm="Delete permanently"
          pending="Deleting…"
          completed="Recording deleted"
          acknowledge="Back to library"
          onAcknowledge={() => {
            void leaveRecording();
          }}
        />
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
          <Input
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

function ConfirmRemoval({
  removal,
  disabled,
  trigger,
  title,
  description,
  keep,
  confirm,
  pending,
  completed,
  acknowledge = "Close",
  onAcknowledge,
}: {
  removal: UseMutationResult<MediaDeletion, Error, void>;
  disabled: boolean;
  trigger: string;
  title: string;
  description: string;
  keep: string;
  confirm: string;
  pending: string;
  completed: string;
  acknowledge?: string;
  onAcknowledge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const focusCompletion = useCallback((button: HTMLButtonElement | null) => button?.focus(), []);
  const cleanupError = removal.data?.cleanupError;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (removal.isPending) return;
        if (!next && cleanupError) {
          onAcknowledge();
          return;
        }
        removal.reset();
        setOpen(next);
      }}
    >
      <AlertDialogTrigger
        render={<Button variant="destructive" className="h-10 px-3 text-sm" />}
        disabled={disabled}
      >
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">
            {cleanupError ? completed : title}
          </AlertDialogTitle>
          <AlertDialogDescription aria-live="polite">
            {cleanupError ?? description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {removal.isError ? (
          <p role="alert" className="text-sm wrap-anywhere text-destructive">
            {removal.error.message}
          </p>
        ) : null}
        <AlertDialogFooter>
          {cleanupError ? (
            <Button ref={focusCompletion} className="h-10 px-3 text-sm" onClick={onAcknowledge}>
              {acknowledge}
            </Button>
          ) : (
            <>
              <AlertDialogCancel className="h-10 px-3 text-sm" disabled={removal.isPending}>
                {keep}
              </AlertDialogCancel>
              <Button
                variant="destructive"
                className="h-10 px-3 text-sm"
                disabled={removal.isPending}
                onClick={() =>
                  removal.mutate(undefined, {
                    onSuccess: (result) => {
                      if (result.cleanupError) return;
                      removal.reset();
                      setOpen(false);
                    },
                  })
                }
              >
                {removal.isPending ? pending : confirm}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
