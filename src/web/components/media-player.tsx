import { type SyntheticEvent, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { mediaFileUrl } from "../lib/api.ts";

export function MediaPlayer({
  item,
  playerRef,
  startMs,
  onPositionChange,
}: {
  item: MediaItem;
  playerRef?: (element: HTMLMediaElement | null) => void;
  startMs?: number | undefined;
  onPositionChange?: (milliseconds: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const seekToStart = (event: SyntheticEvent<HTMLMediaElement>) => {
    if (startMs !== undefined) event.currentTarget.currentTime = startMs / 1000;
  };
  return (
    <div className="space-y-3">
      {item.kind === "video" ? (
        <div className="overflow-hidden rounded-xl bg-black">
          <video
            ref={playerRef}
            className="mx-auto max-h-[65svh] w-full"
            src={mediaFileUrl(item.id)}
            controls
            preload="metadata"
            aria-label={item.title}
            onLoadedMetadata={seekToStart}
            onError={() => setFailed(true)}
            onTimeUpdate={(event) => onPositionChange?.(event.currentTarget.currentTime * 1000)}
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/40 px-4 py-8 sm:px-8">
          <audio
            ref={playerRef}
            className="w-full"
            src={mediaFileUrl(item.id)}
            controls
            preload="metadata"
            aria-label={item.title}
            onLoadedMetadata={seekToStart}
            onError={() => setFailed(true)}
            onTimeUpdate={(event) => onPositionChange?.(event.currentTarget.currentTime * 1000)}
          />
        </div>
      )}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          This file could not be played. Its codec may not be supported by your browser, or the
          saved copy may be unavailable. You can try saving a copy and opening it in another player.
        </p>
      ) : null}
    </div>
  );
}
