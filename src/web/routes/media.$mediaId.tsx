import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { Schema } from "effect";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { AskButton, AskPanel, useAskPanelOpen } from "../components/ask-panel.tsx";
import { MediaPlayer } from "../components/media-player.tsx";
import { NotFound } from "../components/not-found.tsx";
import { RecordingMenu } from "../components/recording-menu.tsx";
import { TranscriptionPanel } from "../components/transcription-panel.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { ApiError, mediaItemOptions, transcriptionOptions } from "../lib/api.ts";
import { formatBytes, formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { searchParams } from "../lib/search-params.ts";
import {
  type TranscriptionActionMutation,
  useTranscriptionAction,
} from "../lib/transcription-actions.ts";

export const Route = createFileRoute("/media/$mediaId")({
  validateSearch: searchParams(
    Schema.Struct({
      startMs: Schema.optional(
        Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      ),
    }),
  ),
  remountDeps: ({ params }) => params.mediaId,
  component: MediaDetail,
});

function describeRecording(item: MediaItem) {
  return [
    item.kind === "video" ? "Video" : "Audio",
    formatDuration(item.durationSeconds),
    item.fileRemovedAt === null ? formatBytes(item.byteSize) : null,
    item.originalName,
  ]
    .filter(Boolean)
    .join(" · ");
}

function SavedCopyRemoved() {
  return (
    <p className="mt-5 flex items-start gap-3 rounded-xl bg-subtle px-4 py-3.5 text-[13px]/5 text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]">
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

function PlaybackWithTranscript({
  item,
  transcribe,
  startMs,
  moment,
  toolbarAction,
}: {
  item: MediaItem;
  transcribe: TranscriptionActionMutation;
  startMs: number | undefined;
  moment: number | undefined;
  toolbarAction: ReactNode;
}) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [positionMs, setPositionMs] = useState(startMs ?? 0);
  const [following, setFollowing] = useState(true);
  const [request, setRequest] = useState({ startMs, moment });
  if (request.startMs !== startMs || request.moment !== moment) {
    setRequest({ startMs, moment });
    if (startMs !== undefined) {
      setPositionMs(startMs);
      setFollowing(true);
    }
  }
  const sought = useRef(request);
  useEffect(() => {
    if (sought.current === request) return;
    sought.current = request;
    if (player.current && request.startMs !== undefined)
      player.current.currentTime = request.startMs / 1000;
  }, [request]);
  const transcription = useQuery(transcriptionOptions(item.id));
  const playerRef = useCallback((element: HTMLMediaElement | null) => {
    player.current = element;
  }, []);
  const seek = useCallback((milliseconds: number) => {
    if (player.current) player.current.currentTime = milliseconds / 1000;
  }, []);
  const resumeFollowing = useCallback(() => setFollowing(true), []);
  return (
    <>
      <MediaPlayer
        item={item}
        transcript={transcription.data?.transcript}
        playerRef={playerRef}
        startMs={startMs}
        onPositionChange={setPositionMs}
        onSeeking={resumeFollowing}
      />
      <TranscriptionPanel
        mediaId={item.id}
        action={transcribe}
        toolbarAction={toolbarAction}
        playback={{
          positionMs,
          onSeek: seek,
          mediaKind: item.kind,
          following,
          onFollowingChange: setFollowing,
        }}
        revealMs={startMs}
      />
    </>
  );
}

function MediaDetail() {
  const { mediaId } = Route.useParams();
  const { startMs } = Route.useSearch();
  const moment = useLocation({ select: (location) => location.state.moment });
  const media = useQuery(mediaItemOptions(mediaId));
  const transcribe = useTranscriptionAction(mediaId);
  const [askOpen, setAskOpen] = useAskPanelOpen();
  const transcription = useQuery({
    ...transcriptionOptions(mediaId),
    enabled: media.isSuccess,
  });
  const askButton = <AskButton open={askOpen} onToggle={() => setAskOpen(!askOpen)} />;
  const transcriptShown = Boolean(transcription.data?.transcript);
  const item = media.data;
  if (media.isError && media.error instanceof ApiError && media.error.status === 404)
    return (
      <NotFound description="The recording may have been deleted, or the link is out of date." />
    );
  return (
    <div
      className={cn(
        "transition-[padding] duration-260 ease-move motion-reduce:transition-none",
        askOpen && item && "min-[1100px]:pr-[clamp(0px,1568px_-_100%,424px)]",
      )}
    >
      <main
        className={`mx-auto max-w-[720px] px-5 pt-5 ${item?.kind === "audio" && item.fileRemovedAt === null ? "pb-32" : "pb-16"}`}
      >
        <div className="-mr-1.5 -ml-2.5 flex items-center justify-between">
          <Link
            to="/"
            aria-label="Back to library"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} data-icon="inline-start" aria-hidden="true" />
            Library
          </Link>
          {item ? (
            <div className="flex items-center gap-1.5">
              {transcriptShown ? null : askButton}
              <RecordingMenu item={item} transcribe={transcribe} />
            </div>
          ) : null}
        </div>
        {media.isPending ? (
          <output aria-label="Loading recording" className="mt-4 grid gap-3 opacity-50">
            <Skeleton className="h-7 w-2/3 rounded-full" />
            <Skeleton className="h-3 w-1/3 rounded-full" />
          </output>
        ) : null}
        {media.isError ? (
          <div role="alert" className="mt-6 space-y-4 rounded-lg border p-6">
            <h1 className="text-lg font-semibold">Could not load this recording</h1>
            <p className="text-sm text-muted-foreground">{media.error.message}</p>
            <Button variant="outline" onClick={() => void media.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        {item ? (
          <>
            <h1 className="mt-3.5 text-[28px]/[34px] font-semibold tracking-[-0.025em] text-balance wrap-anywhere">
              {item.title}
            </h1>
            <p className="mt-1.5 text-[13px]/[normal] wrap-anywhere text-muted-foreground tabular-nums">
              {describeRecording(item)}
            </p>
            {item.fileRemovedAt === null ? (
              <PlaybackWithTranscript
                key={item.id}
                item={item}
                transcribe={transcribe}
                startMs={startMs}
                moment={moment}
                toolbarAction={askButton}
              />
            ) : (
              <>
                <SavedCopyRemoved />
                <TranscriptionPanel
                  key={moment}
                  mediaId={item.id}
                  action={transcribe}
                  revealMs={startMs}
                  toolbarAction={askButton}
                />
              </>
            )}
          </>
        ) : null}
      </main>
      {item ? (
        <AskPanel item={item} open={askOpen} onOpenChange={setAskOpen} transcribe={transcribe} />
      ) : null}
    </div>
  );
}
