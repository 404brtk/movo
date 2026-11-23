import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../../../src/shared/contracts/transcriptions.ts";
import { transcriptPassages } from "../../../../src/shared/transcript-passages.ts";
import {
  chosenSegments,
  playableFrom,
  playOnlyStep,
  speakerNames,
  speakersInOrder,
  transcriptRows,
} from "../../../../src/web/lib/speaker-filter.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const spokenBy = (speaker: number, words: TranscriptWord[]) =>
  words.map((word) => ({ ...word, speaker }));

describe("speaker filter", () => {
  const passages = transcriptPassages([
    ...spokenBy(2, timedWords(0, 900, "Zaczynamy.")),
    ...spokenBy(1, timedWords(1000, 1900, "Dzień dobry.")),
    ...spokenBy(1, timedWords(2000, 2900, "Witam wszystkich.")),
    ...spokenBy(3, timedWords(3000, 3900, "Cześć.")),
    ...spokenBy(2, timedWords(4000, 4900, "Pierwsze pytanie.")),
    ...spokenBy(2, timedWords(5000, 5900, "Drugie pytanie.")),
  ]);

  it("lists speakers in the order they first talk", () => {
    expect(speakersInOrder(passages)).toEqual([2, 1, 3]);
  });

  it("folds each turn of the other speakers into one row", () => {
    expect(transcriptRows(passages, [2])).toEqual([
      { kind: "passage", index: 0 },
      { kind: "fold", speaker: 1, start: 1, end: 3 },
      { kind: "fold", speaker: 3, start: 3, end: 4 },
      { kind: "passage", index: 4 },
      { kind: "passage", index: 5 },
    ]);
    expect(transcriptRows(passages, undefined)).toHaveLength(6);
  });

  it("plays the chosen turns and skips to the next one or stops after the last", () => {
    const segments = chosenSegments(passages, [2]);
    expect(segments).toEqual([
      { startMs: 0, endMs: 900 },
      { startMs: 4000, endMs: 5900 },
    ]);
    expect(chosenSegments(passages, [1, 3])).toEqual([{ startMs: 1000, endMs: 3900 }]);
    expect(playableFrom(segments, 500)).toBe(500);
    expect(playableFrom(segments, 900)).toBe(4000);
    expect(playableFrom(segments, 5900)).toBeUndefined();
  });

  it("skips even a very short interjection", () => {
    const segments = [
      { startMs: 0, endMs: 900 },
      { startMs: 940, endMs: 2000 },
    ];
    expect(playOnlyStep(segments, 500, undefined)).toEqual({ kind: "play" });
    expect(playOnlyStep(segments, 900, undefined)).toEqual({ kind: "seek", toMs: 940 });
    expect(playOnlyStep(segments, 920, undefined)).toEqual({ kind: "seek", toMs: 940 });
    expect(playOnlyStep(segments, 2000, 940)).toEqual({ kind: "pause" });
  });

  it("does not jump again when its own jump lands just before the target", () => {
    const segments = [
      { startMs: 0, endMs: 900 },
      { startMs: 1100, endMs: 2000 },
    ];
    expect(playOnlyStep(segments, 1097, 1100)).toEqual({ kind: "play" });
    expect(playOnlyStep(segments, 1097, undefined)).toEqual({ kind: "seek", toMs: 1100 });
    expect(playOnlyStep(segments, 1000, 1100)).toEqual({ kind: "seek", toMs: 1100 });
  });

  it("names several speakers as a list", () => {
    expect(speakerNames(["Anna"])).toBe("Anna");
    expect(speakerNames(["Anna", "Speaker 2", "Speaker 3"])).toBe("Anna, Speaker 2, and Speaker 3");
  });
});
