import { describe, expect, it } from "vitest";
import { transcriptPage } from "../../../../src/server/mcp/transcript-page.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const sentences = [
  ...timedWords(0, 900, "First sentence."),
  ...timedWords(1000, 1900, "Second sentence."),
  ...timedWords(2000, 2900, "Third sentence."),
];

describe("transcript page", () => {
  it("continues from the next passage until the end", () => {
    expect(transcriptPage(sentences, 0, 2)).toEqual({
      passages: [
        { startMs: 0, endMs: 900, text: "First sentence.", firstWord: 0, wordCount: 2 },
        { startMs: 1000, endMs: 1900, text: "Second sentence.", firstWord: 2, wordCount: 2 },
      ],
      nextFromMs: 2000,
    });
    expect(transcriptPage(sentences, 2000, 2)).toEqual({
      passages: [
        { startMs: 2000, endMs: 2900, text: "Third sentence.", firstWord: 4, wordCount: 2 },
      ],
      nextFromMs: null,
    });
  });

  it("starts at the first passage beginning at or after the requested time", () => {
    expect(transcriptPage(sentences, 500, 1).passages.map((passage) => passage.startMs)).toEqual([
      1000,
    ]);
    expect(transcriptPage(sentences, 3000, 5)).toEqual({ passages: [], nextFromMs: null });
    expect(transcriptPage([], 0, 5)).toEqual({ passages: [], nextFromMs: null });
  });

  it("keeps passages that start at the same time on one page", () => {
    const words = [
      { startMs: 1000, endMs: 1000, text: "Yes." },
      { startMs: 1000, endMs: 1000, text: "No." },
      { startMs: 1000, endMs: 1400, text: "Maybe." },
      ...timedWords(3000, 3500, "Later."),
    ];
    const first = transcriptPage(words, 0, 1);
    expect(first.passages.map((passage) => passage.text)).toEqual(["Yes.", "No.", "Maybe."]);
    expect(first.nextFromMs).toBe(3000);
    expect(transcriptPage(words, 3000, 1).passages.map((passage) => passage.text)).toEqual([
      "Later.",
    ]);
  });
});
