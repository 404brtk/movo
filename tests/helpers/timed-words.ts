import type { TranscriptWord } from "../../src/shared/contracts/transcriptions.ts";

export function timedWords(startMs: number, endMs: number, text: string): TranscriptWord[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const step = (endMs - startMs) / words.length;
  return words.map((word, index) => ({
    startMs: Math.round(startMs + index * step),
    endMs: Math.round(startMs + (index + 1) * step),
    text: word,
  }));
}
