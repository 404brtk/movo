import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoBackward10SecIcon,
  GoForward10SecIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Slider } from "./ui/slider.tsx";

const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const;
const mediaEvents = [
  "play",
  "pause",
  "ended",
  "timeupdate",
  "seeked",
  "durationchange",
  "ratechange",
  "volumechange",
] as const;
const idle = { playing: false, currentTime: 0, mediaDuration: 0, rate: 1, muted: false };

export function useMediaPlayback(fallbackDuration: number) {
  const media = useRef<HTMLMediaElement | null>(null);
  const [element, setElement] = useState<HTMLMediaElement | null>(null);
  const [snapshot, setSnapshot] = useState(idle);
  const attach = useCallback((next: HTMLMediaElement | null) => {
    media.current = next;
    setElement(next);
  }, []);
  useEffect(() => {
    if (!element) return undefined;
    const update = () =>
      setSnapshot({
        playing: !element.paused,
        currentTime: element.currentTime,
        mediaDuration: Number.isFinite(element.duration) ? element.duration : 0,
        rate: element.playbackRate,
        muted: element.muted,
      });
    update();
    for (const name of mediaEvents) element.addEventListener(name, update);
    return () => {
      for (const name of mediaEvents) element.removeEventListener(name, update);
    };
  }, [element]);
  const { mediaDuration, ...state } = element ? snapshot : idle;
  const duration = mediaDuration > 0 ? mediaDuration : fallbackDuration;
  const controls = useMemo(
    () => ({
      toggle: () => {
        const current = media.current;
        if (!current) return;
        if (current.paused) void current.play().catch(() => undefined);
        else current.pause();
      },
      seek: (seconds: number) => {
        if (media.current) media.current.currentTime = Math.max(0, seconds);
      },
      skip: (seconds: number) => {
        if (media.current)
          media.current.currentTime = Math.max(0, media.current.currentTime + seconds);
      },
      setRate: (rate: number) => {
        if (media.current) media.current.playbackRate = rate;
      },
      toggleMute: () => {
        if (media.current) media.current.muted = !media.current.muted;
      },
    }),
    [],
  );
  return { attach, state: { ...state, duration }, controls };
}

export type MediaPlayback = ReturnType<typeof useMediaPlayback>;

const spokenTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const parts = [
    hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
    minutes > 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
    `${total % 60} ${total % 60 === 1 ? "second" : "seconds"}`,
  ];
  return parts.filter(Boolean).join(" ");
};

export const overlayButtonClassName =
  "text-white hover:bg-white/15 hover:text-white aria-expanded:bg-white/20 aria-expanded:text-white aria-pressed:bg-white/20";

export function PlayButton({
  playback,
  className,
  overlay = false,
}: {
  playback: MediaPlayback;
  className?: string;
  overlay?: boolean;
}) {
  const { playing } = playback.state;
  return (
    <Button
      variant={overlay ? "ghost" : "default"}
      size={overlay ? "icon-sm" : "default"}
      aria-label={playing ? "Pause" : "Play"}
      className={cn(overlay && overlayButtonClassName, className)}
      onClick={playback.controls.toggle}
    >
      <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} aria-hidden="true" />
    </Button>
  );
}

export function SkipButton({ playback, seconds }: { playback: MediaPlayback; seconds: -10 | 10 }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={seconds < 0 ? "Back 10 seconds" : "Forward 10 seconds"}
      onClick={() => playback.controls.skip(seconds)}
    >
      <HugeiconsIcon
        icon={seconds < 0 ? GoBackward10SecIcon : GoForward10SecIcon}
        aria-hidden="true"
      />
    </Button>
  );
}

export function SeekSlider({
  playback,
  tone = "default",
}: {
  playback: MediaPlayback;
  tone?: "default" | "overlay";
}) {
  const { currentTime, duration } = playback.state;
  return (
    <Slider
      aria-label="Position"
      tone={tone}
      min={0}
      max={Math.max(duration, 0.001)}
      step={0.1}
      value={Math.min(currentTime, duration)}
      getAriaValueText={(_, value) => `${spokenTime(value)} of ${spokenTime(duration)}`}
      onValueChange={playback.controls.seek}
      className="min-w-0 flex-1"
    />
  );
}

export function SpeedMenu({
  playback,
  className,
}: {
  playback: MediaPlayback;
  className?: string;
}) {
  const { rate } = playback.state;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className={className} />}
        aria-label={`Playback speed ${rate}×`}
      >
        {rate}×
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-28">
        <DropdownMenuRadioGroup value={rate} onValueChange={playback.controls.setRate}>
          {playbackRates.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} closeOnClick>
              {option}×
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
