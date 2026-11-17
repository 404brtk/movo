import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import {
  type MediaPlayback,
  PlayButton,
  SeekSlider,
  SkipButton,
  SpeedMenu,
} from "./playback-controls.tsx";

const floatingSurfaceClassName =
  "rounded-2xl bg-background/78 shadow-player backdrop-blur-[20px] backdrop-saturate-[1.8]";
export const dockedSurfaceClassName = "rounded-2xl bg-background shadow-card";

const playClassName = "size-10 shrink-0 rounded-xl px-0";

export function AudioPlayerBar({
  playback,
  title,
  docked,
  className,
}: {
  playback: MediaPlayback;
  title: string;
  docked: boolean;
  className?: string | undefined;
}) {
  const { currentTime, duration } = playback.state;
  if (docked)
    return (
      <section
        aria-label="Player"
        className={cn("flex items-center gap-3 p-2", dockedSurfaceClassName, className)}
      >
        <PlayButton playback={playback} className={playClassName} />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <SeekSlider playback={playback} />
          <p className="flex justify-between text-[11.5px]/[normal] text-muted-foreground tabular-nums">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </p>
        </div>
        <SpeedMenu playback={playback} />
      </section>
    );
  return (
    <section
      aria-label="Player"
      className={cn(
        "fixed bottom-6 left-1/2 z-40 flex w-[680px] max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 py-2 pr-4 pl-2",
        floatingSurfaceClassName,
        className,
      )}
    >
      <PlayButton playback={playback} className={playClassName} />
      <div className="w-[150px] min-w-0 max-sm:w-24">
        <p className="truncate text-[12.5px]/[normal] font-medium">{title}</p>
        <p className="text-[11.5px]/[normal] text-muted-foreground tabular-nums">
          {formatDuration(currentTime)} of {formatDuration(duration)}
        </p>
      </div>
      <span className="max-sm:hidden">
        <SkipButton playback={playback} seconds={-10} />
      </span>
      <SeekSlider playback={playback} />
      <span className="max-sm:hidden">
        <SkipButton playback={playback} seconds={10} />
      </span>
      <SpeedMenu playback={playback} />
    </section>
  );
}
