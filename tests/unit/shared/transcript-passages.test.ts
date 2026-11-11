import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../../src/shared/contracts/transcriptions.ts";
import {
  currentWordIndex,
  maxPassageCharacters,
  maxPassageMs,
  passageBreakSilenceMs,
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

const longSentence = (clauseEnd: number) =>
  words(
    Array.from({ length: 20 }, (_, index) => (index === clauseEnd ? "word;" : "word")).join(" "),
    100,
  );

describe("transcript passages", () => {
  it("returns no passages without words", () => {
    expect(transcriptPassages([])).toEqual([]);
  });

  it("ends a passage at a long silence even without punctuation", () => {
    const paused = [
      { startMs: 0, endMs: 300, text: "First" },
      { startMs: 300, endMs: 600, text: "part" },
      { startMs: 600 + passageBreakSilenceMs, endMs: 3900, text: "Second" },
      { startMs: 3900, endMs: 4200, text: "part" },
      { startMs: 4200 + passageBreakSilenceMs - 1, endMs: 7500, text: "continues." },
    ];
    expect(texts(paused)).toEqual(["First part", "Second part continues."]);
  });

  it("measures a silence from the latest end of overlapping words", () => {
    const overlapping = [
      { startMs: 0, endMs: 2000, text: "Held" },
      { startMs: 100, endMs: 300, text: "inside" },
      { startMs: 3400, endMs: 3600, text: "after." },
    ];
    expect(texts(overlapping)).toEqual(["Held inside after."]);
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

  it("does not end a passage after a common abbreviation", () => {
    expect(
      texts(words("Mr. Smith met Dr. Jones (e.g. at St. Mary's) etc. today. Meet at 5 p.m. No.")),
    ).toEqual([
      "Mr. Smith met Dr. Jones (e.g. at St. Mary's) etc. today.",
      "Meet at 5 p.m.",
      "No.",
    ]);
  });

  it("splits a long sentence at clause punctuation near its middle", () => {
    const passages = transcriptPassages(longSentence(7));
    expect(passages.map((passage) => passage.words.length)).toEqual([8, 12]);
    expect(passages[0]?.text.endsWith("word;")).toBe(true);
  });

  it("splits a long sentence in the middle when clause punctuation is near its edge", () => {
    const passages = transcriptPassages(longSentence(3));
    expect(passages.map((passage) => passage.words.length)).toEqual([10, 10]);
  });

  it("splits a long sentence into balanced passages without a short remainder", () => {
    expect(
      texts(
        words(
          "For exactly 51 years, the Z340 cipher was one of cryptography's most famous unsolved ciphers. " +
            "Now, as computers got faster, amateur cord breakers threw enormous processing power at this grid of 340 symbols, assuming the zodiac killer had invented some masterwork of encryption.",
        ),
      ),
    ).toEqual([
      "For exactly 51 years, the Z340 cipher was one",
      "of cryptography's most famous unsolved ciphers.",
      "Now, as computers got faster,",
      "amateur cord breakers threw enormous processing power at this grid of 340 symbols,",
      "assuming the zodiac killer had invented some masterwork of encryption.",
    ]);
  });

  it("keeps splitting until every passage fits", () => {
    const long = "x".repeat(maxPassageCharacters - 4);
    expect(texts(words(`first, next ${long} end.`))).toEqual(["first, next", long, "end."]);
  });

  it("splits a sentence that exceeds the character limit", () => {
    const sentence = words(Array.from({ length: 30 }, () => "word").join(" "), 100);
    const passages = transcriptPassages(sentence);
    expect(passages.map((passage) => passage.text.length)).toEqual([74, 74]);
    expect(passages.map((passage) => passage.firstWord)).toEqual([0, 15]);
  });

  it("splits a sentence that exceeds the duration limit", () => {
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

describe("speaker passages", () => {
  it("starts a new passage whenever the speaker changes and reports its speaker", () => {
    const spoken = words("Are you ready yes I am").map((word, index) => ({
      ...word,
      speaker: index < 3 ? 1 : 2,
    }));
    expect(
      transcriptPassages(spoken).map(({ text, speaker, firstWord }) => ({
        text,
        speaker,
        firstWord,
      })),
    ).toEqual([
      { text: "Are you ready", speaker: 1, firstWord: 0 },
      { text: "yes I am", speaker: 2, firstWord: 3 },
    ]);
  });

  it("has no speaker for transcripts without identified speakers", () => {
    expect(transcriptPassages(words("Just one passage")).map((passage) => passage.speaker)).toEqual(
      [undefined],
    );
  });
});
