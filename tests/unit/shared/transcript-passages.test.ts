import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../../src/shared/contracts/transcriptions.ts";
import {
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
});
