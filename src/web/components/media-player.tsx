import { type RefObject, type SyntheticEvent, useCallback, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { exportTranscript } from "../../shared/transcript-export.ts";
import { mediaFileUrl } from "../lib/api.ts";

function SubtitleTrack({
  content,
  language,
  mode,
}: {
  content: string;
  language: string | null;
  mode: RefObject<TextTrackMode>;
}) {
  const attachContent = useCallback(
    (track: HTMLTrackElement | null) => {
      if (!track) return undefined;
      const url = URL.createObjectURL(new Blob([content], { type: "text/vtt" }));
      track.src = url;
      track.track.mode = mode.current;
      return () => {
        mode.current = track.track.mode;
        URL.revokeObjectURL(url);
      };
    },
    [content, mode],
  );
  return (
    <track
      ref={attachContent}
      kind="subtitles"
      label="Transcript"
      srcLang={language ?? undefined}
    />
  );
}

export function MediaPlayer({
  item,
  transcript,
  playerRef,
  startMs,
  onPositionChange,
}: {
  item: MediaItem;
  transcript?: Transcript | null | undefined;
  playerRef?: (element: HTMLMediaElement | null) => void;
  startMs?: number | undefined;
  onPositionChange?: (milliseconds: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const subtitles = useMemo(
    () =>
      item.kind === "video" && transcript?.words.length
        ? exportTranscript(transcript, "vtt")
        : undefined,
    [item.kind, transcript],
  );
  const subtitleMode = useRef<TextTrackMode>("showing");
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
          >
            {subtitles === undefined ? null : (
              <SubtitleTrack
                key={subtitles}
                content={subtitles}
                language={transcript?.language ?? null}
                mode={subtitleMode}
              />
            )}
          </video>
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
