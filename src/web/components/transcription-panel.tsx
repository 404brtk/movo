import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Search01Icon, SearchReplaceIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { maxSearchLength } from "../../shared/contracts/library.ts";
import type { Transcript, TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { transcriptionOptions } from "../lib/api.ts";
import { formatDevice } from "../lib/format.ts";
import { focusOnMount } from "../lib/match-stepper.ts";
import { useReplaceAll } from "../lib/replace-all.ts";
import { pinTranscriptBelow } from "../lib/transcript-follow.ts";
import { replaceShortcut, searchShortcut } from "../lib/transcript-shortcuts.ts";
import {
  hasEdits,
  isActiveTranscription,
  type TranscriptionActionMutation,
  useResultModels,
} from "../lib/transcription-actions.ts";
import { ChangeHistory } from "./change-history.tsx";
import { ReplaceEditsDialog } from "./confirm-dialog.tsx";
import { useFindAndReplace } from "./find-and-replace.tsx";
import { SpeakerFilterMenu, useSpeakerFilter } from "./speaker-filter.tsx";
import { TranscriptActions } from "./transcript-actions.tsx";
import { findBarSelector, type FindTool, TranscriptFindBar } from "./transcript-find-bar.tsx";
import { useTranscriptSearch } from "./transcript-search.tsx";
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
import { Kbd } from "./ui/kbd.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

const isInside = (selector: string) => (target: EventTarget | null) =>
  target instanceof Element && target.closest(selector) !== null;
const insideDialog = isInside("[role=dialog], [role=alertdialog]");
const insideFindBar = isInside(findBarSelector);
const statusClassName = "grid gap-4 pb-2 empty:hidden";

function ToolsZone({ children }: { children: ReactNode }) {
  return (
    <div
      ref={pinTranscriptBelow}
      className="sticky top-(--tools-top) z-20 -mx-5 px-5 py-4 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent after:opacity-0 after:transition-opacity after:duration-150 data-covering:bg-background data-covering:after:opacity-100"
    >
      {children}
    </div>
  );
}

function ToolsRow({ start, end }: { start?: ReactNode; end: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Transcript" className="flex h-9 items-center gap-1.5">
      {start}
      <div className="ml-auto flex items-center gap-1.5">{end}</div>
    </div>
  );
}

function TranscriptView({
  mediaId,
  job,
  transcript,
  modelName,
  playback,
  revealMs,
  toolbarAction,
  status,
}: {
  mediaId: string;
  job: TranscriptionJob;
  transcript: Transcript;
  modelName: string;
  playback: TranscriptPlayback | undefined;
  revealMs: number | undefined;
  toolbarAction: ReactNode;
  status: ReactNode;
}) {
  const filter = useSpeakerFilter(transcript);
  const search = useTranscriptSearch(transcript, filter.chosen);
  const [tool, setTool] = useState<FindTool | null>(search.query === undefined ? null : "search");
  const [returnFocus, setReturnFocus] = useState(tool);
  const [seenQuery, setSeenQuery] = useState(search.query);
  if (search.query !== seenQuery) {
    setSeenQuery(search.query);
    if (search.query !== undefined) {
      if (tool === null) setReturnFocus("search");
      setTool("search");
    }
  }
  const find = useFindAndReplace(transcript, filter.chosen);
  const replace = useReplaceAll(mediaId);
  const field = useRef<HTMLInputElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { revision, resultRevision } = job;
  const edited = hasEdits(job);
  const editable = !isActiveTranscription(job);
  const editing = useMemo<TranscriptEditing | undefined>(
    () => (editable ? { mediaId, revision } : undefined),
    [editable, mediaId, revision],
  );
  const hasWords = transcript.words.length > 0;
  const canReplace = editable && hasWords;
  const shown = !hasWords || (tool === "replace" && !canReplace) ? null : tool;
  const open = (next: FindTool) => {
    if (next === "replace" && shown === "search") {
      find.setFind(search.draft);
      search.clear();
    }
    if (next === "search" && shown === "replace")
      search.setDraft(find.find.slice(0, maxSearchLength));
    if (shown === null) setReturnFocus(next);
    setTool(next);
  };
  const close = () => {
    if (shown === "search") search.clear();
    setTool(null);
  };
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && shown !== null && insideFindBar(event.target)) {
      event.preventDefault();
      close();
      return;
    }
    const wantsReplace = canReplace && replaceShortcut.matches(event);
    const wantsSearch = hasWords && searchShortcut.matches(event);
    if (!wantsReplace && !wantsSearch) return;
    if (insideDialog(event.target)) return;
    if (wantsSearch && shown === "search" && document.activeElement === field.current) return;
    event.preventDefault();
    if (wantsReplace && shown !== "replace") open("replace");
    else if (wantsSearch && shown !== "search") open("search");
    else field.current?.focus();
  });
  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  useEffect(() => {
    if (shown) field.current?.focus();
  }, [shown]);
  const history = (withTrigger: boolean) =>
    editable && (hasWords || edited) ? (
      <ChangeHistory
        mediaId={mediaId}
        revision={revision}
        resultRevision={resultRevision}
        modelName={job.device ? `${modelName} · ${formatDevice(job.device)}` : modelName}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        withTrigger={withTrigger}
      />
    ) : null;
  return (
    <>
      <ToolsZone>
        {shown ? (
          <TranscriptFindBar
            tool={shown}
            replace={replace}
            revision={revision}
            search={search}
            find={find}
            filter={filter}
            canReplace={canReplace}
            fieldRef={field}
            onToolChange={open}
            onClose={close}
          />
        ) : (
          <ToolsRow
            end={
              <>
                {toolbarAction}
                {hasWords ? (
                  <TranscriptActions mediaId={mediaId} transcript={transcript} filter={filter} />
                ) : null}
              </>
            }
            start={
              <>
                {hasWords ? (
                  <Button
                    ref={returnFocus === "search" ? focusOnMount : undefined}
                    variant="toggle"
                    size="sm"
                    aria-keyshortcuts={searchShortcut.keys}
                    className="max-sm:w-7 max-sm:px-0"
                    onClick={() => open("search")}
                  >
                    <HugeiconsIcon
                      icon={Search01Icon}
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                    <span className="max-sm:sr-only">Search</span>
                    <Kbd aria-hidden="true" className="ml-0.5 max-sm:hidden">
                      {searchShortcut.label}
                    </Kbd>
                  </Button>
                ) : null}
                {canReplace ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        ref={returnFocus === "replace" ? focusOnMount : undefined}
                        render={
                          <Button variant="toggle" size="sm" className="max-sm:w-7 max-sm:px-0" />
                        }
                        aria-keyshortcuts={replaceShortcut.keys}
                        onClick={() => open("replace")}
                      >
                        <HugeiconsIcon
                          icon={SearchReplaceIcon}
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        <span className="max-sm:sr-only">Replace</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Find and replace
                        <span className="ml-1.5 text-background/60 tabular-nums">
                          {replaceShortcut.label}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                {history(true)}
                {filter.choices.length > 0 ? <SpeakerFilterMenu filter={filter} /> : null}
              </>
            }
          />
        )}
      </ToolsZone>
      {shown ? history(false) : null}
      <div className={statusClassName}>{status}</div>
      {hasWords ? (
        <TranscriptReader
          transcript={transcript}
          playback={playback}
          revealMs={revealMs}
          editing={editing}
          searching={shown !== null}
          chosenSpeakers={filter.chosen}
          skipping={filter.only}
          matches={shown === "replace" ? find.matches : undefined}
          found={shown === "search" ? search.found : undefined}
        />
      ) : (
        <p className="text-[15px]/6 text-muted-foreground">
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
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const job = query.data;
  const fileAvailable = playback !== undefined;
  const resultModels = useResultModels(job);
  const transcript = job?.transcript;
  const active = isActiveTranscription(job);
  const status = (
    <>
      {query.isPending ? (
        <output aria-label="Loading transcript" className="grid gap-3 opacity-50">
          <Skeleton className="h-3 w-12 rounded-full" />
          <Skeleton className="h-3.5 w-full rounded-full" />
          <Skeleton className="h-3.5 w-3/4 rounded-full" />
        </output>
      ) : null}
      {query.isError ? (
        <div role="alert" className="space-y-4 rounded-lg border p-6">
          <p className="text-sm">{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {action.isError ? (
        <p role="alert" className="text-[13px]/5 wrap-anywhere text-destructive">
          {action.error.message}
        </p>
      ) : null}
      {query.isSuccess && job === null && fileAvailable ? (
        <NoTranscriptCard
          title="No transcript yet"
          description="Movo transcribes this recording on this computer. You can keep browsing while it runs, and search what was said once it finishes."
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
      {job && (job.status === "failed" || job.status === "interrupted") && !fileAvailable ? (
        <p role="alert" className="text-[13px]/5 wrap-anywhere text-destructive">
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
        <p role="alert" className="text-[13px]/5 wrap-anywhere text-warning">
          {job.cleanupError}
        </p>
      ) : null}
      {transcript && job && !["completed", "cancelled"].includes(job.status) ? (
        <p className="text-xs text-muted-foreground">
          {active
            ? "Showing the previous transcript until the new one completes."
            : "Showing the previous transcript."}
        </p>
      ) : null}
    </>
  );
  return (
    <section aria-label="Transcription">
      {job && transcript ? (
        <TranscriptView
          mediaId={mediaId}
          job={job}
          transcript={transcript}
          modelName={resultModels}
          playback={playback}
          revealMs={revealMs}
          toolbarAction={toolbarAction}
          status={status}
        />
      ) : (
        <>
          <ToolsZone>
            <ToolsRow end={toolbarAction} />
          </ToolsZone>
          <div className={statusClassName}>{status}</div>
        </>
      )}
      <ReplaceEditsDialog
        open={confirmingRetry}
        onOpenChange={setConfirmingRetry}
        transcribe={action}
      />
    </section>
  );
}
