import type { RefObject } from "react";
import {
  ClosedCaptionIcon,
  FullScreenIcon,
  VolumeHighIcon,
  VolumeMute02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatDuration } from "../lib/format.ts";
import {
  type MediaPlayback,
  overlayButtonClassName,
  PlayButton,
  SeekSlider,
  SpeedMenu,
} from "./playback-controls.tsx";
import { Button } from "./ui/button.tsx";

const timeClassName = "text-xs tabular-nums";

export function VideoControls({
  playback,
  frame,
  subtitles,
}: {
  playback: MediaPlayback;
  frame: RefObject<HTMLElement | null>;
  subtitles: { showing: boolean; toggle: () => void } | null;
}) {
  const { state, controls } = playback;
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-linear-to-b from-transparent to-[oklch(0.15_0.02_262/0.55)] px-3.5 pt-7 pb-3 text-white transition-opacity duration-200 ease-snappy text-shadow-[0_1px_2px_oklch(0_0_0/0.4)] max-sm:gap-x-1.5 max-sm:px-2.5 video-idle:opacity-0 [&_svg]:drop-shadow-[0_1px_2px_oklch(0_0_0/0.4)]">
      <PlayButton playback={playback} overlay />
      <span className={timeClassName}>{formatDuration(state.currentTime)}</span>
      <SeekSlider
        playback={playback}
        tone="overlay"
        className="max-sm:order-first max-sm:basis-full max-sm:px-1.5"
      />
      <span className={`${timeClassName} max-sm:mr-auto`}>
        <span aria-hidden="true" className="mr-1.5 sm:hidden">
          /
        </span>
        {formatDuration(state.duration)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Mute"
        aria-pressed={state.muted}
        className={`${overlayButtonClassName} pointer-coarse:hidden`}
        onClick={controls.toggleMute}
      >
        <HugeiconsIcon icon={state.muted ? VolumeMute02Icon : VolumeHighIcon} aria-hidden="true" />
      </Button>
      {subtitles ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Subtitles"
          aria-pressed={subtitles.showing}
          className={overlayButtonClassName}
          onClick={subtitles.toggle}
        >
          <HugeiconsIcon icon={ClosedCaptionIcon} aria-hidden="true" />
        </Button>
      ) : null}
      <SpeedMenu playback={playback} className={overlayButtonClassName} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Full screen"
        className={overlayButtonClassName}
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void frame.current?.requestFullscreen();
        }}
      >
        <HugeiconsIcon icon={FullScreenIcon} aria-hidden="true" />
      </Button>
    </div>
  );
}
