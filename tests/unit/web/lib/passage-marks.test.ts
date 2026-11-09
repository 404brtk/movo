import { describe, expect, it } from "vitest";
import { findWords } from "../../../../src/shared/transcript-edits.ts";
import { transcriptPassages } from "../../../../src/shared/transcript-passages.ts";
import { marksByPassage } from "../../../../src/web/lib/passage-marks.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

describe("passage marks", () => {
  const words = [
    ...timedWords(0, 2000, "We run kuber"),
    ...timedWords(6000, 8000, "netes daily. Kuber netes"),
  ];
  const passages = transcriptPassages(words);

  it("splits a match across every passage it spans", () => {
    expect(passages.map((passage) => passage.firstWord)).toEqual([0, 3, 5]);
    const marks = marksByPassage(passages, {
      ranges: findWords(words, "kuber netes"),
      current: 0,
    });
    expect(marks.get(0)).toEqual([{ start: 2, end: 3, current: true }]);
    expect(marks.get(3)).toEqual([{ start: 0, end: 1, current: true }]);
    expect(marks.get(5)).toEqual([{ start: 0, end: 2, current: false }]);
  });
});
