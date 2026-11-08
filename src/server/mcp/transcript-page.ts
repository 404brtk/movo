import type { TranscriptWord } from "../../shared/contracts/transcriptions.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";

export const defaultPagePassages = 200;
export const maxPagePassages = 300;

export function transcriptPage(
  words: readonly TranscriptWord[],
  fromMs: number,
  maxPassages: number,
) {
  const passages = transcriptPassages(words);
  const first = passages.findIndex((passage) => passage.startMs >= fromMs);
  if (first === -1) return { passages: [], nextFromMs: null };
  let end = Math.min(first + maxPassages, passages.length);
  while (end < passages.length && passages[end]?.startMs === passages[end - 1]?.startMs) end++;
  return {
    passages: passages
      .slice(first, end)
      .map(({ startMs, endMs, text, firstWord, words: passageWords }) => ({
        startMs,
        endMs,
        text,
        firstWord,
        wordCount: passageWords.length,
      })),
    nextFromMs: passages[end]?.startMs ?? null,
  };
}
