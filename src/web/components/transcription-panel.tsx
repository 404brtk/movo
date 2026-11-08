import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  cancelTranscription,
  enqueueTranscription,
  retryTranscription,
  transcriptionOptions,
} from "../lib/api.ts";
import { formatDevice } from "../lib/format.ts";
import { ChangeHistory } from "./change-history.tsx";
import { FindAndReplace } from "./find-and-replace.tsx";
import { MediaToolsSetup } from "./media-tools-setup.tsx";
import { TranscriptActions } from "./transcript-actions.tsx";
import {
  TranscriptReader,
  type TranscriptEditing,
  type TranscriptPlayback,
} from "./transcript-reader.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";

const phaseLabels = {
  queued: "Waiting to transcribe…",
  preparing: "Preparing audio…",
  loading: "Loading Parakeet Ultra…",
  transcribing: "Transcribing…",
  finished: "",
};

export function TranscriptionPanel({
  mediaId,
  playback,
  revealMs,
}: {
  mediaId: string;
  playback?: TranscriptPlayback;
  revealMs?: number | undefined;
}) {
  const options = transcriptionOptions(mediaId);
  const query = useQuery(options);
  const client = useQueryClient();
  const [showTools, setShowTools] = useState(false);
  const [editTool, setEditTool] = useState<"replace" | "history" | null>(null);
  const action = useMutation({
    mutationFn: (operation: "start" | "cancel" | "retry") =>
      operation === "start"
        ? enqueueTranscription(mediaId)
        : operation === "cancel"
          ? cancelTranscription(mediaId)
          : retryTranscription(mediaId),
    onMutate: () => client.cancelQueries({ queryKey: options.queryKey, exact: true }),
    onSuccess: (job) => {
      client.setQueryData(options.queryKey, job);
    },
    onSettled: () => client.invalidateQueries({ queryKey: options.queryKey, exact: true }),
  });
  const job = query.data;
  const active = job?.status === "queued" || job?.status === "running";
  const revision = job?.revision ?? 0;
  const resultRevision = job?.resultRevision ?? 0;
  const edited = revision > resultRevision;
  const editable = Boolean(job?.transcript) && !active;
  const editing = useMemo<TranscriptEditing | undefined>(
    () => (editable ? { mediaId, revision } : undefined),
    [editable, mediaId, revision],
  );
  const hasWords = (job?.transcript?.words.length ?? 0) > 0;
  const toggleEditTool = (tool: "replace" | "history") =>
    setEditTool((current) => (current === tool ? null : tool));
  const headingId = `transcription-${mediaId}`;
  return (
    <section aria-labelledby={headingId} className="space-y-5 border-t pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 id={headingId} className="text-xl font-semibold">
            Transcription
          </h2>
          <p className="text-sm text-muted-foreground">
            Parakeet Ultra · processed on this computer{edited ? " · edited" : ""}.
          </p>
        </div>
        {playback && query.isSuccess && !job ? (
          <Button disabled={action.isPending} onClick={() => action.mutate("start")}>
            Transcribe
          </Button>
        ) : null}
        {active ? (
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate("cancel")}
          >
            Cancel transcription
          </Button>
        ) : null}
        {playback && job && !active ? (
          <RetryTranscription
            label={job.status === "completed" ? "Transcribe again" : "Retry transcription"}
            variant={job.status === "completed" ? "outline" : "default"}
            confirm={edited}
            disabled={action.isPending}
            onRetry={() => action.mutate("retry")}
          />
        ) : null}
      </div>
      {query.isPending ? (
        <output className="block text-sm text-muted-foreground">Checking transcription…</output>
      ) : null}
      {query.isError ? (
        <div role="alert" className="space-y-3 text-sm">
          <p>{query.error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {action.isError ? (
        <p role="alert" className="text-sm wrap-anywhere text-destructive">
          {action.error.message}
        </p>
      ) : null}
      {job?.error ? (
        <p role="alert" className="text-sm wrap-anywhere text-destructive">
          {job.error}
        </p>
      ) : null}
      {job?.cleanupError && job.cleanupError !== job.error ? (
        <p role="alert" className="text-sm wrap-anywhere text-destructive">
          {job.cleanupError}
        </p>
      ) : null}
      {active ? (
        <output className="block text-sm text-muted-foreground">
          {phaseLabels[job.phase]} You can browse other recordings while it runs. Keep Movo running.
        </output>
      ) : null}
      {job?.device ? (
        <p className="text-sm wrap-anywhere text-muted-foreground">
          {job.status === "completed"
            ? "Transcribed on"
            : active
              ? "Running on"
              : "Last attempt ran on"}{" "}
          {formatDevice(job.device)}
        </p>
      ) : null}
      {job?.status === "cancelled" ? (
        <output className="block text-sm text-muted-foreground">Transcription cancelled.</output>
      ) : null}
      {job?.transcript && job.status !== "completed" ? (
        <p className="text-sm text-muted-foreground">
          Showing the previous transcript until a new one completes.
        </p>
      ) : null}
      {editing && (hasWords || edited) ? (
        <div className="flex flex-wrap gap-2">
          {hasWords ? (
            <Button
              variant="outline"
              className="h-10 px-3 text-sm"
              aria-expanded={editTool === "replace"}
              onClick={() => toggleEditTool("replace")}
            >
              Find and replace
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="h-10 px-3 text-sm"
            aria-expanded={editTool === "history"}
            onClick={() => toggleEditTool("history")}
          >
            History
          </Button>
        </div>
      ) : null}
      {editing && job?.transcript && hasWords && editTool === "replace" ? (
        <FindAndReplace
          mediaId={mediaId}
          revision={revision}
          transcript={job.transcript}
          onClose={() => setEditTool(null)}
        />
      ) : null}
      {editing && editTool === "history" ? (
        <ChangeHistory
          mediaId={mediaId}
          revision={revision}
          resultRevision={resultRevision}
          onClose={() => setEditTool(null)}
        />
      ) : null}
      {job?.transcript ? (
        job.transcript.words.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {edited
              ? "Every passage was removed. Restore an earlier version from History."
              : "No speech was detected in this recording."}
          </p>
        ) : (
          <>
            <TranscriptActions mediaId={mediaId} transcript={job.transcript} />
            <TranscriptReader
              transcript={job.transcript}
              playback={playback}
              revealMs={revealMs}
              editing={editing}
            />
          </>
        )
      ) : null}
      {!active ? (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link
            to="/models"
            className="inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Models
          </Link>
          <Button
            variant="ghost"
            aria-expanded={showTools}
            aria-controls="media-tools-setup"
            onClick={() => setShowTools(!showTools)}
          >
            Media tools
          </Button>
        </div>
      ) : null}
      {showTools ? <MediaToolsSetup onClose={() => setShowTools(false)} /> : null}
    </section>
  );
}

function RetryTranscription({
  label,
  variant,
  confirm,
  disabled,
  onRetry,
}: {
  label: string;
  variant: "default" | "outline";
  confirm: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!confirm)
    return (
      <Button variant={variant} disabled={disabled} onClick={onRetry}>
        {label}
      </Button>
    );
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} />} disabled={disabled}>
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace your edits?</AlertDialogTitle>
          <AlertDialogDescription>
            The new transcript replaces your edits and their history when it completes. Until then,
            the edited transcript stays available and editing is paused.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-10 px-3 text-sm">Keep edits</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-10 px-3 text-sm"
            onClick={() => {
              setOpen(false);
              onRetry();
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
