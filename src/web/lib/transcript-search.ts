import type { TextRange } from "../../shared/contracts/library.ts";
import { containsEveryTerm, matchedRanges } from "../../shared/search-text.ts";
import type { TranscriptPassage } from "../../shared/transcript-passages.ts";
import type { TranscriptSpeakers } from "../../shared/transcript-speakers.ts";
import type { PassageMark } from "./passage-marks.ts";

export interface PassageHit {
  marks: PassageMark[];
  speaker: { name: string; ranges: readonly TextRange[] } | undefined;
}

export interface TranscriptFound {
  hits: ReadonlyMap<number, PassageHit>;
  current: number | undefined;
}

export function searchPassages(
  passages: readonly TranscriptPassage[],
  speakers: Pick<TranscriptSpeakers, "nameOf">,
  terms: readonly string[],
) {
  const hits = new Map<number, PassageHit>();
  if (terms.length === 0) return hits;
  for (const passage of passages) {
    const name = passage.speaker === undefined ? null : speakers.nameOf(passage.speaker);
    if (!containsEveryTerm(name === null ? [passage.text] : [passage.text, name], terms)) continue;
    const speakerRanges = name === null ? [] : matchedRanges(name, terms);
    hits.set(passage.firstWord, {
      marks: passage.words.flatMap((word, index) =>
        matchedRanges(word.text, terms).length > 0
          ? [{ start: index, end: index + 1, current: false }]
          : [],
      ),
      speaker:
        name === null || speakerRanges.length === 0 ? undefined : { name, ranges: speakerRanges },
    });
  }
  return hits;
}
