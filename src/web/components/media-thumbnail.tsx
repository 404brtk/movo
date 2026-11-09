import type { MediaItem } from "../../shared/contracts/media.ts";

const videoHues = [250, 205, 175, 285, 320, 352] as const;
const waveformBars = 11;

function hash(text: string) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

function waveformHeights(seed: number) {
  let state = seed;
  return Array.from({ length: waveformBars }, () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    return Math.round(25 + ((state % 1000) / 1000) * 75);
  });
}

function Waveform({ seed }: { seed: number }) {
  return (
    <span className="flex h-7 w-11 items-center gap-0.5">
      {waveformHeights(seed).map((height, index) => (
        <span
          key={index}
          className="flex-1 rounded-[1px] bg-linear-to-b from-primary-from to-primary-to"
          style={{ height: `${height}%` }}
        />
      ))}
    </span>
  );
}

function VideoFrame({ hue }: { hue: number }) {
  return (
    <span
      className="relative block h-7 w-11 overflow-hidden rounded-[7px] bg-[linear-gradient(160deg,oklch(0.95_0.05_var(--hue)),oklch(0.86_0.1_calc(var(--hue)+12)))] shadow-[inset_0_0_0_1px_oklch(0.4_0.08_var(--hue)/0.1)]"
      style={{ "--hue": hue }}
    >
      <span className="absolute inset-y-[5px] right-3 left-[5px] rounded-[3.5px] bg-white shadow-[0_0.5px_1.5px_oklch(0.3_0.06_260/0.22)]" />
      <span className="absolute top-[9px] left-[9px] h-0.5 w-[11px] rounded-[1px] bg-[oklch(0.72_0.01_262)]" />
      <span className="absolute top-[14px] left-[9px] h-0.5 w-[18px] rounded-[1px] bg-input" />
      <span className="absolute top-[19px] left-[9px] h-0.5 w-[13px] rounded-[1px] bg-input" />
      <span className="absolute right-[5px] bottom-1 size-[13px] rounded-full bg-[linear-gradient(180deg,oklch(0.73_0.15_var(--hue)),oklch(0.6_0.18_calc(var(--hue)+6)))] shadow-[0_0_0_1.5px_white,0_1px_2px_oklch(0.35_0.1_var(--hue)/0.35)]">
        <span className="absolute top-[3.5px] left-[5px] h-1.5 w-[4.5px] bg-white [clip-path:polygon(0_0,100%_50%,0_100%)]" />
      </span>
    </span>
  );
}

export function MediaThumbnail({ item }: { item: Pick<MediaItem, "id" | "kind"> }) {
  const seed = hash(item.id);
  return (
    <span aria-hidden="true" className="grid h-[30px] w-11 shrink-0 place-items-center">
      {item.kind === "video" ? (
        <VideoFrame hue={videoHues[seed % videoHues.length] ?? videoHues[0]} />
      ) : (
        <Waveform seed={seed} />
      )}
    </span>
  );
}
