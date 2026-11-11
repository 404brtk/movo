import { type SyntheticEvent, useCallback, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { exportTranscript } from "../../shared/transcript-export.ts";
import { mediaFileUrl } from "../lib/api.ts";
import { pinHeight } from "../lib/transcript-follow.ts";
import { AudioPlayerBar } from "./audio-player-bar.tsx";
import { useMediaPlayback } from "./playback-controls.tsx";
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

const pinToTop = pinHeight("--pinned-player");

export function MediaPlayer({
  item,
  transcript,
  playerRef,
  startMs,
  onPositionChange,
  onSeeking,
}: {
  item: MediaItem;
  transcript?: Transcript | null | undefined;
  playerRef?: (element: HTMLMediaElement | null) => void;
  startMs?: number | undefined;
  onPositionChange?: (milliseconds: number) => void;
  onSeeking?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const playback = useMediaPlayback(item.durationSeconds);
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
        <AudioPlayerBar playback={playback} title={item.title} />
        {failure}
      </>
    );
  return (
    <div
      ref={pinToTop}
      className="sticky top-0 z-30 bg-background pt-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent"
    >
      <section
        ref={frame}
        aria-label="Video player"
        data-playing={playback.state.playing || undefined}
        className="relative overflow-hidden rounded-[14px] bg-black shadow-[0_0_0_1px_oklch(0.2_0.01_262/0.06),0_8px_24px_-10px_oklch(0.2_0.01_262/0.25)] [&:fullscreen]:rounded-none"
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
          <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] -translate-y-11 rounded-md bg-black/75 px-2.5 py-1 text-center text-base/snug text-balance whitespace-pre-line text-white transition-transform duration-200 ease-snappy in-[:fullscreen]:text-2xl max-sm:-translate-y-14 sm:text-lg video-idle:translate-y-0">
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
      {failure}
    </div>
  );
}
