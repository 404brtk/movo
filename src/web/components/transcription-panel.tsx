import { type ReactNode, useMemo, useState } from "react";
import { SearchReplaceIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import type { Transcript, TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { modelsOptions, transcriptionOptions } from "../lib/api.ts";
import { formatDevice } from "../lib/format.ts";
import {
  hasEdits,
  isActiveTranscription,
  type TranscriptionActionMutation,
} from "../lib/transcription-actions.ts";
import { cn } from "../lib/utils.ts";
import { ChangeHistory } from "./change-history.tsx";
import { ReplaceEditsDialog } from "./confirm-dialog.tsx";
import { FindAndReplace, useFindAndReplace } from "./find-and-replace.tsx";
import { TranscriptActions } from "./transcript-actions.tsx";
import {
  TranscriptReader,
  type TranscriptEditing,
  type TranscriptPlayback,
} from "./transcript-reader.tsx";
import {
  FailedTranscriptionCard,
  NoTranscriptCard,
  TranscribingCard,
} from "./transcription-state.tsx";
import { Button } from "./ui/button.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

function TranscriptView({
  mediaId,
  job,
  transcript,
  modelName,
  playback,
  revealMs,
  toolbarAction,
}: {
  mediaId: string;
  job: TranscriptionJob;
  transcript: Transcript;
  modelName: string;
  playback: TranscriptPlayback | undefined;
  revealMs: number | undefined;
  toolbarAction: ReactNode;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const find = useFindAndReplace(transcript);
  const { revision, resultRevision } = job;
  const edited = hasEdits(job);
  const editable = !isActiveTranscription(job);
  const editing = useMemo<TranscriptEditing | undefined>(
    () => (editable ? { mediaId, revision } : undefined),
    [editable, mediaId, revision],
  );
  const hasWords = transcript.words.length > 0;
  const showFind = findOpen && editable && hasWords;
  return (
    <>
      <div
        className={cn(
          "mt-[18px] flex flex-wrap items-center gap-1.5",
          !showFind && "border-b pb-[18px]",
        )}
      >
        <span className="mr-1.5 text-xs text-muted-foreground">
          {modelName}
          {edited ? " · edited" : ""}
        </span>
        {editable ? (
          <div className="flex items-center gap-1.5">
            {hasWords ? (
              <Button
                variant="toggle"
                size="sm"
                aria-expanded={showFind}
                onClick={() => setFindOpen(!findOpen)}
              >
                <HugeiconsIcon
                  icon={SearchReplaceIcon}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Find and replace
              </Button>
            ) : null}
            <ChangeHistory
              mediaId={mediaId}
              revision={revision}
              resultRevision={resultRevision}
              modelName={job.device ? `${modelName} · ${formatDevice(job.device)}` : modelName}
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {toolbarAction}
          {hasWords ? <TranscriptActions mediaId={mediaId} transcript={transcript} /> : null}
        </div>
      </div>
      {showFind ? (
        <FindAndReplace
          mediaId={mediaId}
          revision={revision}
          state={find}
          onClose={() => setFindOpen(false)}
        />
      ) : null}
      {hasWords ? (
        <TranscriptReader
          transcript={transcript}
          playback={playback}
          revealMs={revealMs}
          editing={editing}
          searching={showFind}
          matches={showFind ? find.matches : undefined}
        />
      ) : (
        <p className="mt-6 text-[15px]/6 text-muted-foreground">
          {edited
            ? "Every passage was removed. Restore an earlier version from History."
            : "No speech was detected in this recording."}
        </p>
      )}
    </>
  );
}

export function TranscriptionPanel({
  mediaId,
  action,
  playback,
  revealMs,
  toolbarAction,
}: {
  mediaId: string;
  action: TranscriptionActionMutation;
  playback?: TranscriptPlayback | undefined;
  revealMs?: number | undefined;
  toolbarAction?: ReactNode;
}) {
  const query = useQuery(transcriptionOptions(mediaId));
  const models = useQuery(modelsOptions);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const job = query.data;
  const fileAvailable = playback !== undefined;
  const modelName =
    models.data?.find((model) => model.id === job?.modelId)?.name ?? "Parakeet Ultra";
  const transcript = job?.transcript;
  const active = isActiveTranscription(job);
  return (
    <section aria-label="Transcription">
      {query.isPending ? (
        <output aria-label="Loading transcript" className="mt-8 grid gap-3 opacity-50">
          <Skeleton className="h-3 w-12 rounded-full" />
          <Skeleton className="h-3.5 w-full rounded-full" />
          <Skeleton className="h-3.5 w-3/4 rounded-full" />
        </output>
      ) : null}
      {query.isError ? (
        <div role="alert" className="mt-8 space-y-4 rounded-lg border p-6">
          <p className="text-sm">{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {action.isError ? (
        <p role="alert" className="mt-5 text-[13px]/5 wrap-anywhere text-destructive">
          {action.error.message}
        </p>
      ) : null}
      {query.isSuccess && job === null && fileAvailable ? (
        <NoTranscriptCard
          title="No transcript yet"
          description={`${modelName} transcribes this recording on this computer. You can keep browsing while it runs, and search what was said once it finishes.`}
          action="Transcribe"
          pending={action.isPending}
          onStart={() => action.mutate("start")}
        />
      ) : null}
      {job && active ? (
        <TranscribingCard
          job={job}
          cancelling={action.isPending}
          onCancel={() => action.mutate("cancel")}
        />
      ) : null}
      {job && (job.status === "failed" || job.status === "interrupted") && fileAvailable ? (
        <FailedTranscriptionCard
          job={job}
          retrying={action.isPending}
          onRetry={() => (hasEdits(job) ? setConfirmingRetry(true) : action.mutate("retry"))}
        />
      ) : null}
      <ReplaceEditsDialog
        open={confirmingRetry}
        onOpenChange={setConfirmingRetry}
        transcribe={action}
      />
      {job && (job.status === "failed" || job.status === "interrupted") && !fileAvailable ? (
        <p role="alert" className="mt-5 text-[13px]/5 wrap-anywhere text-destructive">
          {job.error}
        </p>
      ) : null}
      {job?.status === "cancelled" && !transcript && fileAvailable ? (
        <NoTranscriptCard
          title="Transcription stopped"
          description="It was cancelled before it finished. Start it again whenever you like."
          action="Transcribe"
          pending={action.isPending}
          onStart={() => action.mutate("retry")}
        />
      ) : null}
      {job?.cleanupError && job.cleanupError !== job.error ? (
        <p role="alert" className="mt-5 text-[13px]/5 wrap-anywhere text-warning">
          {job.cleanupError}
        </p>
      ) : null}
      {job && transcript ? (
        <>
          {job.status === "completed" ? null : (
            <p className="mt-6 text-xs text-muted-foreground">
              {active
                ? "Showing the previous transcript until the new one completes."
                : "Showing the previous transcript."}
            </p>
          )}
          <TranscriptView
            mediaId={mediaId}
            job={job}
            transcript={transcript}
            modelName={modelName}
            playback={playback}
            revealMs={revealMs}
            toolbarAction={toolbarAction}
          />
        </>
      ) : null}
    </section>
  );
}
