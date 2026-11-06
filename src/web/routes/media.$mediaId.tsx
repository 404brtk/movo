import { ArrowLeft02Icon, Download04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { MediaPlayer } from "../components/media-player.tsx";
import { MediaActions } from "../components/media-actions.tsx";
import { TranscriptionPanel } from "../components/transcription-panel.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { ApiError, mediaFileUrl, mediaItemOptions } from "../lib/api.ts";
import { formatBytes, formatDuration, formatImportDate } from "../lib/format.ts";

export const Route = createFileRoute("/media/$mediaId")({ component: MediaDetail });

function PlaybackWithTranscript({ item }: { item: MediaItem }) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const playerRef = useCallback((element: HTMLMediaElement | null) => {
    player.current = element;
  }, []);
  const seek = useCallback((milliseconds: number) => {
    if (player.current) player.current.currentTime = milliseconds / 1000;
  }, []);
  return (
    <>
      <MediaPlayer item={item} playerRef={playerRef} onPositionChange={setPositionMs} />
      <TranscriptionPanel mediaId={item.id} positionMs={positionMs} onSeek={seek} />
    </>
  );
}

function MediaDetail() {
  const { mediaId } = Route.useParams();
  const media = useQuery(mediaItemOptions(mediaId));
  const item = media.data;
  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <Link
        to="/"
        className="mb-8 inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} size={18} aria-hidden="true" />
        Back to library
      </Link>
      {media.isPending ? (
        <output className="block py-12 text-sm text-muted-foreground">Loading media…</output>
      ) : null}
      {media.isError ? (
        <div role="alert" className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {media.error instanceof ApiError && media.error.status === 404
              ? "Media not found"
              : "Could not load media"}
          </h1>
          <p className="text-sm text-muted-foreground">{media.error.message}</p>
          {media.error instanceof ApiError && media.error.status === 404 ? null : (
            <Button
              variant="outline"
              onClick={() => {
                void media.refetch();
              }}
            >
              Try again
            </Button>
          )}
        </div>
      ) : null}
      {item ? (
        <div className="space-y-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="min-w-0 space-y-2">
              <h1 className="text-3xl font-semibold tracking-[-0.035em] wrap-anywhere sm:text-4xl">
                {item.title}
              </h1>
              <p className="text-sm wrap-anywhere text-muted-foreground">{item.originalName}</p>
            </div>
            <a
              className={buttonVariants({
                variant: "outline",
                className: "h-10 w-fit gap-2 px-3 text-sm",
              })}
              href={mediaFileUrl(item.id)}
              download={item.originalName}
            >
              <HugeiconsIcon icon={Download04Icon} size={18} aria-hidden="true" />
              Save a copy
            </a>
          </div>
          <MediaActions key={item.id} item={item} />
          <PlaybackWithTranscript key={item.id} item={item} />
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center text-sm underline underline-offset-4"
            >
              View original source
            </a>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-t pt-6 text-sm sm:grid-cols-4">
            <div className="space-y-1.5">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{item.kind === "video" ? "Video" : "Audio"}</dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="tabular-nums">{formatDuration(item.durationSeconds)}</dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-muted-foreground">File size</dt>
              <dd>{formatBytes(item.byteSize)}</dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-muted-foreground">Imported</dt>
              <dd>
                <time dateTime={new Date(item.importedAt).toISOString()}>
                  {formatImportDate(item.importedAt)}
                </time>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </main>
  );
}
