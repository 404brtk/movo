import type { TranscriptPassage } from "../../shared/transcript-passages.ts";

export type TranscriptRow =
  | { kind: "passage"; index: number }
  | { kind: "fold"; speaker: number | undefined; start: number; end: number };

export interface PlaySegment {
  startMs: number;
  endMs: number;
}

export const skipToleranceMs = 50;

export const spokenBy = (speakers: readonly number[], speaker: number | undefined) =>
  speaker !== undefined && speakers.includes(speaker);

export function speakersInOrder(passages: readonly TranscriptPassage[]) {
  return [...new Set(passages.flatMap(({ speaker }) => (speaker === undefined ? [] : [speaker])))];
}

export function transcriptRows(
  passages: readonly TranscriptPassage[],
  chosen: readonly number[] | undefined,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  passages.forEach(({ speaker }, index) => {
    const last = rows.at(-1);
    if (chosen === undefined || spokenBy(chosen, speaker)) rows.push({ kind: "passage", index });
    else if (last?.kind === "fold" && last.speaker === speaker) last.end = index + 1;
    else rows.push({ kind: "fold", speaker, start: index, end: index + 1 });
  });
  return rows;
}

export function chosenSegments(
  passages: readonly TranscriptPassage[],
  chosen: readonly number[],
): PlaySegment[] {
  const segments: PlaySegment[] = [];
  let continuing = false;
  for (const { speaker, startMs, endMs } of passages) {
    const last = segments.at(-1);
    if (!spokenBy(chosen, speaker)) continuing = false;
    else if (continuing && last) last.endMs = Math.max(last.endMs, endMs);
    else {
      segments.push({ startMs, endMs });
      continuing = true;
    }
  }
  return segments;
}

export function playableFrom(segments: readonly PlaySegment[], positionMs: number) {
  const segment = segments.find(({ endMs }) => positionMs < endMs);
  return segment && Math.max(positionMs, segment.startMs);
}

export function playOnlyStep(
  segments: readonly PlaySegment[],
  positionMs: number,
  landingMs: number | undefined,
): { kind: "play" } | { kind: "pause" } | { kind: "seek"; toMs: number } {
  const target = playableFrom(segments, positionMs);
  if (target === undefined) return { kind: "pause" };
  return target - positionMs <= skipToleranceMs || target === landingMs
    ? { kind: "play" }
    : { kind: "seek", toMs: target };
}

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

export const speakerNames = (labels: readonly string[]) => listFormat.format(labels);
