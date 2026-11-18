import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Schema } from "effect";
import { maxSearchLength } from "../../shared/contracts/library.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { AskButton, AskPanel, useAskPanelOpen } from "../components/ask-panel.tsx";
import { BackToLibrary } from "../components/back-to-library.tsx";
import { MediaPlayer } from "../components/media-player.tsx";
import { NotFound } from "../components/not-found.tsx";
import { RecordingMenu } from "../components/recording-menu.tsx";
import { SourceLink } from "../components/source-site.tsx";
import { TranscriptionPanel } from "../components/transcription-panel.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { ApiError, mediaItemOptions, transcriptionOptions } from "../lib/api.ts";
import { formatBytes, formatDuration } from "../lib/format.ts";
import { useMediaQuery } from "../lib/media-query.ts";
import { cn } from "../lib/utils.ts";
import { searchParams } from "../lib/search-params.ts";
import {
  hasEdits,
  type TranscriptionActionMutation,
  useModelName,
  useTranscriptionAction,
} from "../lib/transcription-actions.ts";

export const Route = createFileRoute("/media/$mediaId")({
  validateSearch: searchParams(
    Schema.Struct({
      startMs: Schema.optional(
        Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      ),
      q: Schema.optional(Schema.String.check(Schema.isMaxLength(maxSearchLength))),
    }),
  ),
  remountDeps: ({ params }) => params.mediaId,
  component: MediaDetail,
});

const splitView = "(width >= 64rem)";
const splitViewBesideAsk = "(width >= 78rem)";

function RecordingDetails({ item }: { item: MediaItem }) {
  const facts = [
    item.kind === "video" ? "Video" : "Audio",
    formatDuration(item.durationSeconds),
    item.fileRemovedAt === null ? formatBytes(item.byteSize) : null,
    item.sourceUrl === null ? item.originalName : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <p className="mt-1.5 text-[13px]/[normal] wrap-anywhere text-muted-foreground tabular-nums">
      {facts}
      {item.sourceUrl === null ? null : (
        <>
          {" · "}
          <SourceLink url={item.sourceUrl} />
        </>
      )}
    </p>
  );
}

function SavedCopyRemoved({ className }: { className?: string | undefined }) {
  return (
    <p
      className={cn(
        "flex items-start gap-3 rounded-xl bg-subtle px-4 py-3.5 text-[13px]/5 text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]",
        className,
      )}
    >
      <HugeiconsIcon
        icon={InformationCircleIcon}
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0"
      />
      <span>
        <strong className="font-medium text-foreground">
          Saved copy removed to free up space.
        </strong>{" "}
        The transcript and its exports are still here. Playback and transcribing again need the
        file, so import it again if you want them back.
      </span>
    </p>
  );
}

function BackRow({ split, actions }: { split: boolean; actions?: ReactNode }) {
  return (
    <div
      className={
        split
          ? "mb-5"
          : "sticky top-(--app-header) z-20 -mx-5 flex h-(--back-row) items-center bg-background px-5"
      }
    >
      <div className="-mr-1.5 -ml-2.5 flex flex-1 items-center justify-between">
        <BackToLibrary />
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
      </div>
    </div>
  );
}

function RecordingHeading({
  item,
  split,
  job,
}: {
  item: MediaItem;
  split: boolean;
  job: TranscriptionJob | null | undefined;
}) {
  const modelName = useModelName(job?.modelId);
  return (
    <div className={split ? "order-1 mt-5" : "mt-1"}>
      <h1
        className={cn(
          "font-semibold text-balance wrap-anywhere",
          split ? "text-xl/[26px] tracking-[-0.015em]" : "text-[28px]/[34px] tracking-[-0.025em]",
        )}
      >
        {item.title}
      </h1>
      <RecordingDetails item={item} />
      {job?.transcript ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {modelName}
          {hasEdits(job) ? " · edited" : ""}
        </p>
      ) : null}
    </div>
  );
}

function usePlaybackSync(startMs: number | undefined, moment: number | undefined) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [positionMs, setPositionMs] = useState(startMs ?? 0);
  const [following, setFollowing] = useState(true);
  const [jumps, setJumps] = useState(0);
  const [request, setRequest] = useState({ startMs, moment });
  if (request.startMs !== startMs || request.moment !== moment) {
    setRequest({ startMs, moment });
    if (startMs !== undefined) {
      setPositionMs(startMs);
      setFollowing(true);
      setJumps(jumps + 1);
    }
  }
  const sought = useRef(request);
  useEffect(() => {
    if (sought.current === request) return;
    sought.current = request;
    if (player.current && request.startMs !== undefined)
      player.current.currentTime = request.startMs / 1000;
  }, [request]);
  const playerRef = useCallback((element: HTMLMediaElement | null) => {
    player.current = element;
  }, []);
  const seek = useCallback((milliseconds: number) => {
    if (player.current) player.current.currentTime = milliseconds / 1000;
  }, []);
  const resumeFollowing = useCallback(() => setFollowing(true), []);
  const stopFollowing = useCallback(() => setFollowing(false), []);
  return {
    playerRef,
    positionMs,
    setPositionMs,
    following,
    setFollowing,
    jumps,
    seek,
    resumeFollowing,
    stopFollowing,
  };
}

function RecordingWorkspace({
  item,
  split,
  transcribe,
  askButton,
  startMs,
  moment,
}: {
  item: MediaItem;
  split: boolean;
  transcribe: TranscriptionActionMutation;
  askButton: ReactNode;
  startMs: number | undefined;
  moment: number | undefined;
}) {
  const sync = usePlaybackSync(startMs, moment);
  const transcription = useQuery(transcriptionOptions(item.id));
  const job = transcription.data;
  const fileAvailable = item.fileRemovedAt === null;
  const floatingPlayer = fileAvailable && item.kind === "audio" && !split;
  const compactPlayer = fileAvailable && item.kind === "video" && !split;
  return (
    <main
      className={cn(
        "mx-auto",
        split
          ? "grid max-w-[1192px] grid-cols-[minmax(17rem,1fr)_minmax(27.5rem,42.5rem)] items-start gap-x-12 px-6 [--tools-top:var(--app-header)]"
          : "max-w-[720px] px-5 pt-2.5",
        !split &&
          (compactPlayer
            ? "[--tools-top:calc(var(--app-header)+var(--back-row)+var(--compact-player))]"
            : "[--tools-top:calc(var(--app-header)+var(--back-row))]"),
        floatingPlayer ? "pb-32" : "pb-16",
      )}
    >
      <div
        className={
          split ? "sticky top-[calc(var(--app-header)+1.25rem)] mt-5 flex flex-col" : "contents"
        }
      >
        <BackRow split={split} actions={<RecordingMenu item={item} transcribe={transcribe} />} />
        <RecordingHeading item={item} split={split} job={job} />
        {fileAvailable ? (
          <MediaPlayer
            item={item}
            transcript={job?.transcript}
            layout={split ? "split" : "single"}
            className={split ? undefined : "mt-5"}
            playerRef={sync.playerRef}
            startMs={startMs}
            onPositionChange={sync.setPositionMs}
            onSeeking={sync.resumeFollowing}
            onShowVideo={sync.stopFollowing}
          />
        ) : (
          <SavedCopyRemoved className={split ? undefined : "mt-5"} />
        )}
      </div>
      <div className={split ? "min-w-0" : "contents"}>
        <TranscriptionPanel
          key={fileAvailable ? undefined : moment}
          mediaId={item.id}
          action={transcribe}
          toolbarAction={askButton}
          revealMs={startMs}
          playback={
            fileAvailable
              ? {
                  positionMs: sync.positionMs,
                  onSeek: sync.seek,
                  floatingPlayer,
                  following: sync.following,
                  jumps: sync.jumps,
                  onFollowingChange: sync.setFollowing,
                }
              : undefined
          }
        />
      </div>
    </main>
  );
}

function MediaDetail() {
  const { mediaId } = Route.useParams();
  const { startMs } = Route.useSearch();
  const moment = useLocation({ select: (location) => location.state.moment });
  const media = useQuery(mediaItemOptions(mediaId));
  const transcribe = useTranscriptionAction(mediaId);
  const [askOpen, setAskOpen] = useAskPanelOpen();
  const split = useMediaQuery(askOpen ? splitViewBesideAsk : splitView);
  const askButton = <AskButton open={askOpen} onToggle={() => setAskOpen(!askOpen)} />;
  const item = media.data;
  if (media.isError && media.error instanceof ApiError && media.error.status === 404)
    return (
      <NotFound description="The recording may have been deleted, or the link is out of date." />
    );
  return (
    <div
      className={cn(
        "pr-(--ask-inset) transition-[padding] duration-260 ease-move [--app-header:0px] [--ask-inset:0px] [--back-row:3rem] [--compact-player:4.5rem] motion-reduce:transition-none sm:[--app-header:3.5rem]",
        askOpen && item && "min-[60rem]:[--ask-inset:clamp(0px,2040px_-_100%,424px)]",
      )}
    >
      {item ? (
        <RecordingWorkspace
          item={item}
          split={split}
          transcribe={transcribe}
          askButton={askButton}
          startMs={startMs}
          moment={moment}
        />
      ) : (
        <main className="mx-auto max-w-[720px] px-5 pt-2.5 pb-16">
          <BackRow split={false} />
          {media.isPending ? (
            <output aria-label="Loading recording" className="mt-1 grid gap-3 opacity-50">
              <Skeleton className="h-7 w-2/3 rounded-full" />
              <Skeleton className="h-3 w-1/3 rounded-full" />
            </output>
          ) : null}
          {media.isError ? (
            <div role="alert" className="mt-3 space-y-4 rounded-lg border p-6">
              <h1 className="text-lg font-semibold">Could not load this recording</h1>
              <p className="text-sm text-muted-foreground">{media.error.message}</p>
              <Button variant="outline" onClick={() => void media.refetch()}>
                Try again
              </Button>
            </div>
          ) : null}
        </main>
      )}
      {item ? (
        <AskPanel item={item} open={askOpen} onOpenChange={setAskOpen} transcribe={transcribe} />
      ) : null}
    </div>
  );
}
