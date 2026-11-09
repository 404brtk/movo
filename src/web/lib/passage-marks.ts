import type { TranscriptPassage } from "../../shared/transcript-passages.ts";

export interface TranscriptMatches {
  ranges: readonly { firstWord: number; wordCount: number }[];
  current: number;
}

export interface PassageMark {
  start: number;
  end: number;
  current: boolean;
}

export function marksByPassage(
  passages: readonly TranscriptPassage[],
  matches: TranscriptMatches | undefined,
) {
  const marks = new Map<number, PassageMark[]>();
  if (!matches) return marks;
  let passageIndex = 0;
  matches.ranges.forEach((range, index) => {
    const rangeEnd = range.firstWord + range.wordCount;
    while ((passages[passageIndex + 1]?.firstWord ?? Infinity) <= range.firstWord) passageIndex++;
    for (let at = passageIndex; at < passages.length; at++) {
      const passage = passages[at];
      if (!passage || passage.firstWord >= rangeEnd) break;
      const entries = marks.get(passage.firstWord) ?? [];
      entries.push({
        start: Math.max(range.firstWord - passage.firstWord, 0),
        end: Math.min(rangeEnd - passage.firstWord, passage.words.length),
        current: index === matches.current,
      });
      marks.set(passage.firstWord, entries);
    }
  });
  return marks;
}
