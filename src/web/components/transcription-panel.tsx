import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  cancelTranscription,
  enqueueTranscription,
  retryTranscription,
  transcriptionOptions,
} from "../lib/api.ts";
import { formatDevice } from "../lib/format.ts";
import { MediaToolsSetup } from "./media-tools-setup.tsx";
import { TranscriptActions } from "./transcript-actions.tsx";
import { TranscriptReader, type TranscriptPlayback } from "./transcript-reader.tsx";
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
}: {
  mediaId: string;
  playback?: TranscriptPlayback;
}) {
  const options = transcriptionOptions(mediaId);
  const query = useQuery(options);
  const client = useQueryClient();
  const [showTools, setShowTools] = useState(false);
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
  const headingId = `transcription-${mediaId}`;
  return (
    <section aria-labelledby={headingId} className="space-y-5 border-t pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 id={headingId} className="text-xl font-semibold">
            Transcription
          </h2>
          <p className="text-sm text-muted-foreground">
            Parakeet Ultra · processed on this computer.
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
          <Button
            variant={job.status === "completed" ? "outline" : "default"}
            disabled={action.isPending}
            onClick={() => action.mutate("retry")}
          >
            {job.status === "completed" ? "Transcribe again" : "Retry transcription"}
          </Button>
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
      {job?.transcript ? (
        job.transcript.words.length === 0 ? (
          <p className="text-sm text-muted-foreground">No speech was detected in this recording.</p>
        ) : (
          <>
            <TranscriptActions mediaId={mediaId} transcript={job.transcript} />
            <TranscriptReader transcript={job.transcript} playback={playback} />
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
