import { type RefObject, type SyntheticEvent, useCallback, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { exportTranscript } from "../../shared/transcript-export.ts";
import { mediaFileUrl } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import type { PlaySegment } from "../lib/speaker-filter.ts";
import { scrollBehavior } from "../lib/transcript-follow.ts";
import { cn } from "../lib/utils.ts";
import { AudioPlayerBar, dockedSurfaceClassName } from "./audio-player-bar.tsx";
import { MediaThumbnail } from "./media-thumbnail.tsx";
import {
  type MediaPlayback,
  PlayButton,
  SeekSlider,
  SpeedMenu,
  useMediaPlayback,
} from "./playback-controls.tsx";
import { Button } from "./ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";
import { VideoControls } from "./video-controls.tsx";

function SubtitleTrack({
  content,
  language,
  onCaptionChange,
}: {
  content: string;
  language: string | null;
  onCaptionChange: (caption: string) => void;
}) {
  const attachContent = useCallback(
    (track: HTMLTrackElement | null) => {
      if (!track) return undefined;
      const url = URL.createObjectURL(new Blob([content], { type: "text/vtt" }));
      const textTrack = track.track;
      const showCues = (cues: Iterable<TextTrackCue>) =>
        onCaptionChange(
          Array.from(cues)
            .filter((cue) => cue instanceof VTTCue)
            .map((cue) => cue.getCueAsHTML().textContent)
            .join("\n"),
        );
      const showActiveCues = () => showCues(textTrack.activeCues ?? []);
      const showCuesAtCurrentTime = () => {
        const media = track.parentElement;
        if (!(media instanceof HTMLMediaElement)) return;
        showCues(
          Array.from(textTrack.cues ?? []).filter(
            (cue) => cue.startTime <= media.currentTime && media.currentTime < cue.endTime,
          ),
        );
      };
      track.src = url;
      textTrack.mode = "hidden";
      textTrack.addEventListener("cuechange", showActiveCues);
      track.addEventListener("load", showCuesAtCurrentTime);
      return () => {
        textTrack.removeEventListener("cuechange", showActiveCues);
        track.removeEventListener("load", showCuesAtCurrentTime);
        URL.revokeObjectURL(url);
        onCaptionChange("");
      };
    },
    [content, onCaptionChange],
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

function CompactPlayer({
  item,
  playback,
  frame,
  onShowVideo,
}: {
  item: MediaItem;
  playback: MediaPlayback;
  frame: RefObject<HTMLElement | null>;
  onShowVideo: () => void;
}) {
  const [shown, setShown] = useState(false);
  const { currentTime, duration } = playback.state;
  const followFrame = useCallback(
    (slot: HTMLElement | null) => {
      if (!slot) return undefined;
      const update = () => {
        const video = frame.current?.getBoundingClientRect();
        setShown(video !== undefined && video.bottom < slot.getBoundingClientRect().bottom - 1);
      };
      update();
      window.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      return () => {
        window.removeEventListener("scroll", update);
        window.removeEventListener("resize", update);
      };
    },
    [frame],
  );
  const showVideo = () => {
    const video = frame.current;
    if (!video) return;
    onShowVideo();
    video.focus({ preventScroll: true });
    const margin = Number.parseFloat(getComputedStyle(video).scrollMarginTop) || 0;
    window.scrollTo({
      top: window.scrollY + video.getBoundingClientRect().top - margin,
      behavior: scrollBehavior(),
    });
  };
  return (
    <div
      ref={followFrame}
      aria-hidden={!shown || undefined}
      className={cn(
        "sticky top-[calc(var(--app-header)+var(--back-row))] z-30 -mx-5 -mt-(--compact-player) flex h-(--compact-player) items-center bg-background px-5 transition-[opacity,visibility] duration-150 ease-out motion-reduce:transition-none",
        shown ? "visible opacity-100" : "invisible opacity-0",
      )}
    >
      <section
        aria-label="Player"
        className={cn("flex h-14 w-full items-center gap-3 py-2 pr-4 pl-2", dockedSurfaceClassName)}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  aria-label="Show the video"
                  className="h-10 w-15 rounded-xl px-0"
                />
              }
              onClick={showVideo}
            >
              <MediaThumbnail item={item} />
            </TooltipTrigger>
            <TooltipContent>Show the video</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PlayButton playback={playback} className="size-10 shrink-0 rounded-xl px-0" />
        <div className="min-w-0 flex-1 sm:w-[150px] sm:flex-none">
          <p className="truncate text-[12.5px]/[normal] font-medium">{item.title}</p>
          <p className="text-[11.5px]/[normal] text-muted-foreground tabular-nums">
            {formatDuration(currentTime)} of {formatDuration(duration)}
          </p>
        </div>
        <SeekSlider playback={playback} className="max-sm:hidden" />
        <SpeedMenu playback={playback} className="max-sm:hidden" />
      </section>
    </div>
  );
}

export function MediaPlayer({
  item,
  transcript,
  layout,
  className,
  playerRef,
  startMs,
  onPositionChange,
  onSeeking,
  onShowVideo,
  playOnly,
}: {
  item: MediaItem;
  playOnly?: { segments: readonly PlaySegment[]; names: string } | undefined;
  transcript?: Transcript | null | undefined;
  layout: "split" | "single";
  className?: string | undefined;
  playerRef?: (element: HTMLMediaElement | null) => void;
  startMs?: number | undefined;
  onPositionChange?: (milliseconds: number) => void;
  onSeeking?: () => void;
  onShowVideo: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const playback = useMediaPlayback(item.durationSeconds, playOnly?.segments);
  const { attach: attachPlayback, controls } = playback;
  const subtitles = useMemo(
    () =>
      item.kind === "video" && transcript?.words.length
        ? exportTranscript(transcript, "vtt")
        : undefined,
    [item.kind, transcript],
  );
  const [subtitlesShowing, setSubtitlesShowing] = useState(
    () => !window.matchMedia("(width < 40rem)").matches,
  );
  const [caption, setCaption] = useState("");
  const attach = useCallback(
    (media: HTMLMediaElement | null) => {
      attachPlayback(media);
      playerRef?.(media);
    },
    [attachPlayback, playerRef],
  );
  const mediaProps = {
    src: mediaFileUrl(item.id),
    preload: "metadata",
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (startMs !== undefined) event.currentTarget.currentTime = startMs / 1000;
    },
    onError: () => setFailed(true),
    onSeeking,
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) =>
      onPositionChange?.(event.currentTarget.currentTime * 1000),
  } as const;
  const playOnlyNote = playOnly ? (
    <p className="mt-2.5 flex items-center gap-2 text-xs text-primary-strong">
      <span aria-hidden="true" className="h-1 w-2.5 shrink-0 rounded-[2px] bg-primary/30" />
      <span className="min-w-0 truncate">Playing only {playOnly.names}</span>
    </p>
  ) : null;
  const failure = failed ? (
    <p role="alert" className="mt-3 text-[13px]/5 text-pretty text-destructive">
      This file could not be played. Its codec may not be supported by your browser, or the saved
      copy may be unavailable. You can save a copy and open it in another player.
    </p>
  ) : null;
  if (item.kind === "audio")
    return (
      <>
        <audio ref={attach} aria-label={item.title} className="hidden" {...mediaProps} />
        <AudioPlayerBar
          playback={playback}
          title={item.title}
          docked={layout === "split"}
          className={className}
        />
        {playOnlyNote}
        {failure}
      </>
    );
  return (
    <>
      <section
        ref={frame}
        aria-label="Video player"
        tabIndex={-1}
        data-playing={playback.state.playing || undefined}
        className={cn(
          "@container relative scroll-mt-[calc(var(--app-header)+var(--back-row))] overflow-hidden rounded-[14px] bg-black shadow-[0_0_0_1px_oklch(0.2_0.01_262/0.06),0_8px_24px_-10px_oklch(0.2_0.01_262/0.25)] outline-none [&:fullscreen]:rounded-none",
          className,
        )}
      >
        <video
          ref={attach}
          aria-label={item.title}
          className="block aspect-video max-h-[65svh] w-full in-[:fullscreen]:aspect-auto in-[:fullscreen]:h-full in-[:fullscreen]:max-h-none"
          onClick={controls.toggle}
          {...mediaProps}
        >
          {subtitles === undefined ? null : (
            <SubtitleTrack
              key={subtitles}
              content={subtitles}
              language={transcript?.language ?? null}
              onCaptionChange={setCaption}
            />
          )}
        </video>
        {subtitlesShowing && caption ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] -translate-y-11 rounded-md bg-black/75 px-2.5 py-1 text-center text-base/snug text-balance whitespace-pre-line text-white transition-transform duration-200 ease-snappy in-[:fullscreen]:text-2xl @max-sm:-translate-y-14 @sm:text-lg video-idle:translate-y-0">
            {caption}
          </p>
        ) : null}
        <VideoControls
          playback={playback}
          frame={frame}
          subtitles={
            subtitles === undefined
              ? null
              : {
                  showing: subtitlesShowing,
                  toggle: () => setSubtitlesShowing(!subtitlesShowing),
                }
          }
        />
      </section>
      {layout === "single" ? (
        <CompactPlayer item={item} playback={playback} frame={frame} onShowVideo={onShowVideo} />
      ) : null}
      {playOnlyNote}
      {failure}
    </>
  );
}
