import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../../src/shared/contracts/transcriptions.ts";
import {
  currentWordIndex,
  maxPassageCharacters,
  maxPassageMs,
  transcriptPassages,
} from "../../../src/shared/transcript-passages.ts";

function words(text: string, stepMs = 300): TranscriptWord[] {
  return text.split(" ").map((word, index) => ({
    startMs: index * stepMs,
    endMs: (index + 1) * stepMs,
    text: word,
  }));
}

const texts = (value: readonly TranscriptWord[]) =>
  transcriptPassages(value).map((passage) => passage.text);

describe("transcript passages", () => {
  it("returns no passages without words", () => {
    expect(transcriptPassages([])).toEqual([]);
  });

  it("ends a passage after each sentence, including closing quotes and brackets", () => {
    expect(texts(words('Is it? Yes! "Done." (Really.) Wait… And the rest'))).toEqual([
      "Is it?",
      "Yes!",
      '"Done."',
      "(Really.)",
      "Wait…",
      "And the rest",
    ]);
  });

  it("keeps a sentence with internal punctuation together", () => {
    expect(texts(words("First, second; third: fourth."))).toEqual([
      "First, second; third: fourth.",
    ]);
  });

  it("starts a new passage before a word that would exceed the character limit", () => {
    const sentence = words(Array.from({ length: 30 }, () => "word").join(" "), 100);
    const passages = transcriptPassages(sentence);
    expect(passages.map((passage) => passage.text.length)).toEqual([84, 64]);
    expect(passages.every((passage) => passage.text.length <= maxPassageCharacters)).toBe(true);
    expect(passages.map((passage) => passage.firstWord)).toEqual([0, 17]);
  });

  it("starts a new passage before a word that would exceed the duration limit", () => {
    const slow = words("one two three four five", 2000);
    const passages = transcriptPassages(slow);
    expect(passages.map((passage) => passage.text)).toEqual(["one two three", "four five"]);
    expect(passages.every((passage) => passage.endMs - passage.startMs <= maxPassageMs)).toBe(true);
  });

  it("keeps a single word that exceeds both limits as its own passage", () => {
    const long = "x".repeat(maxPassageCharacters + 10);
    const value: TranscriptWord[] = [
      { startMs: 0, endMs: 100, text: "Before" },
      { startMs: 100, endMs: 20000, text: long },
      { startMs: 20000, endMs: 20100, text: "after." },
    ];
    expect(texts(value)).toEqual(["Before", long, "after."]);
  });

  it("reports passage timing from its words, including overlapping word ends", () => {
    const value: TranscriptWord[] = [
      { startMs: 100, endMs: 900, text: "Overlapping" },
      { startMs: 200, endMs: 400, text: "words." },
      { startMs: 1000, endMs: 1500, text: "Next." },
    ];
    expect(transcriptPassages(value)).toMatchObject([
      { startMs: 100, endMs: 900, firstWord: 0, text: "Overlapping words." },
      { startMs: 1000, endMs: 1500, firstWord: 2, text: "Next." },
    ]);
  });

  it("measures the duration limit to the latest word end, not only the next word", () => {
    const value: TranscriptWord[] = [
      { startMs: 0, endMs: 8000, text: "Hello" },
      { startMs: 100, endMs: 200, text: "world." },
    ];
    const passages = transcriptPassages(value);
    expect(passages.map((passage) => passage.text)).toEqual(["Hello", "world."]);
    expect(
      passages.every(
        (passage) => passage.words.length === 1 || passage.endMs - passage.startMs <= maxPassageMs,
      ),
    ).toBe(true);
  });
});

describe("current word", () => {
  const timeline: TranscriptWord[] = [
    { startMs: 100, endMs: 400, text: "One" },
    { startMs: 400, endMs: 700, text: "two" },
    { startMs: 400, endMs: 800, text: "same" },
    { startMs: 900, endMs: 1200, text: "three." },
  ];

  it.each([
    [0, -1],
    [99, -1],
    [100, 0],
    [399, 0],
    [400, 2],
    [850, 2],
    [900, 3],
    [60000, 3],
  ])("selects the last word started by %i ms", (positionMs, expected) => {
    expect(currentWordIndex(timeline, positionMs)).toBe(expected);
  });

  it("finds no word in an empty transcript", () => {
    expect(currentWordIndex([], 1000)).toBe(-1);
  });

  it("matches a linear search across a long transcript", () => {
    const long = words(Array.from({ length: 1001 }, (_, index) => `w${index}`).join(" "), 250);
    for (let positionMs = -1; positionMs <= 251000; positionMs += 97)
      expect(currentWordIndex(long, positionMs)).toBe(
        long.findLastIndex((word) => word.startMs <= positionMs),
      );
  });
});
