import { useCallback, useRef, useState } from "react";
import { ArrowLeft02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Schema } from "effect";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { MediaPlayer } from "../components/media-player.tsx";
import { NotFound } from "../components/not-found.tsx";
import { RecordingMenu } from "../components/recording-menu.tsx";
import { TranscriptionPanel } from "../components/transcription-panel.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { ApiError, mediaItemOptions, transcriptionOptions } from "../lib/api.ts";
import { formatBytes, formatDuration } from "../lib/format.ts";
import { searchParams } from "../lib/search-params.ts";

export const Route = createFileRoute("/media/$mediaId")({
  validateSearch: searchParams(
    Schema.Struct({
      startMs: Schema.optional(
        Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      ),
    }),
  ),
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
  startMs,
}: {
  item: MediaItem;
  startMs: number | undefined;
}) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [positionMs, setPositionMs] = useState(startMs ?? 0);
  const transcription = useQuery(transcriptionOptions(item.id));
  const playerRef = useCallback((element: HTMLMediaElement | null) => {
    player.current = element;
  }, []);
  const seek = useCallback((milliseconds: number) => {
    if (player.current) player.current.currentTime = milliseconds / 1000;
  }, []);
  return (
    <>
      <MediaPlayer
        item={item}
        transcript={transcription.data?.transcript}
        playerRef={playerRef}
        startMs={startMs}
        onPositionChange={setPositionMs}
      />
      <TranscriptionPanel
        mediaId={item.id}
        playback={{ positionMs, onSeek: seek }}
        revealMs={startMs}
      />
    </>
  );
}

function MediaDetail() {
  const { mediaId } = Route.useParams();
  const { startMs } = Route.useSearch();
  const media = useQuery(mediaItemOptions(mediaId));
  const item = media.data;
  if (media.isError && media.error instanceof ApiError && media.error.status === 404)
    return (
      <NotFound description="The recording may have been deleted, or the link is out of date." />
    );
  return (
    <main
      className={`mx-auto max-w-[720px] px-5 pt-5 ${item?.kind === "audio" && item.fileRemovedAt === null ? "pb-32" : "pb-16"}`}
    >
      <div className="-mx-2.5 flex items-center justify-between">
        <Link
          to="/"
          aria-label="Back to library"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} data-icon="inline-start" aria-hidden="true" />
          Library
        </Link>
        {item ? <RecordingMenu key={item.id} item={item} /> : null}
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
            <PlaybackWithTranscript key={`${item.id}:${startMs}`} item={item} startMs={startMs} />
          ) : (
            <>
              <SavedCopyRemoved />
              <TranscriptionPanel mediaId={item.id} revealMs={startMs} />
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
