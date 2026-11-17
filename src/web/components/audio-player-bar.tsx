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
        className={cn("grid gap-2 px-4 pt-4 pb-2", dockedSurfaceClassName, className)}
      >
        <div className="grid gap-1.5">
          <SeekSlider playback={playback} />
          <p className="flex justify-between text-[11.5px]/[normal] text-muted-foreground tabular-nums">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </p>
        </div>
        <div className="-mx-2 grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="col-start-2 flex items-center gap-2">
            <SkipButton playback={playback} seconds={-10} />
            <PlayButton playback={playback} className={playClassName} />
            <SkipButton playback={playback} seconds={10} />
          </div>
          <SpeedMenu playback={playback} className="justify-self-end" />
        </div>
      </section>
    );
  return (
    <section
      aria-label="Player"
      className={cn(
        "fixed bottom-6 left-[calc((100%-var(--ask-inset,0px))/2)] z-40 flex w-[680px] max-w-[calc(100%-var(--ask-inset,0px)-2rem)] -translate-x-1/2 items-center gap-3 py-2 pr-4 pl-2 transition-[left,max-width] duration-260 ease-move motion-reduce:transition-none",
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
