import { formatDuration } from "../lib/format.ts";
import {
  type MediaPlayback,
  PlayButton,
  SeekSlider,
  SkipButton,
  SpeedMenu,
} from "./playback-controls.tsx";

export function AudioPlayerBar({ playback, title }: { playback: MediaPlayback; title: string }) {
  const { currentTime, duration } = playback.state;
  return (
    <section
      aria-label="Player"
      className="fixed bottom-6 left-1/2 z-40 flex w-[680px] max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-background/78 py-2 pr-4 pl-2 shadow-player backdrop-blur-[20px] backdrop-saturate-[1.8]"
    >
      <PlayButton playback={playback} className="size-10 shrink-0 rounded-xl px-0" />
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
