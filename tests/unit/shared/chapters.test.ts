import { describe, expect, it } from "vitest";
import {
  chapterRanges,
  currentChapterIndex,
  parseMoment,
  summaryGist,
  videoDescriptionChapters,
} from "../../../src/shared/chapters.ts";

const chapters = [
  { id: "a", startMs: 0, title: "Wstęp i goście" },
  { id: "b", startMs: 252_000, title: "Czy AI zabierze nam pracę?" },
  { id: "c", startMs: 3_785_000, title: "Pytania słuchaczy" },
];

describe("chapters", () => {
  it("finds the chapter playing at a position", () => {
    expect(currentChapterIndex(chapters, 0)).toBe(0);
    expect(currentChapterIndex(chapters, 251_999)).toBe(0);
    expect(currentChapterIndex(chapters, 252_000)).toBe(1);
    expect(currentChapterIndex(chapters, 9_000_000)).toBe(2);
    expect(currentChapterIndex([{ startMs: 5000 }], 1000)).toBe(-1);
    expect(currentChapterIndex([], 1000)).toBe(-1);
  });

  it("ends each chapter where the next one starts and the last one with the recording", () => {
    expect(
      chapterRanges(chapters, 4_000_000).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 252_000],
      [252_000, 3_785_000],
      [3_785_000, 4_000_000],
    ]);
  });

  it("lists chapters as lines for a video description", () => {
    expect(videoDescriptionChapters(chapters)).toBe(
      "0:00 Wstęp i goście\n4:12 Czy AI zabierze nam pracę?\n1:03:05 Pytania słuchaczy",
    );
  });

  it("reads typed times and rejects anything else", () => {
    expect(parseMoment("4:12")).toBe(252_000);
    expect(parseMoment(" 1:03:05 ")).toBe(3_785_000);
    expect(parseMoment("75:00")).toBe(4_500_000);
    expect(parseMoment("4:60")).toBeNull();
    expect(parseMoment("1:60:00")).toBeNull();
    expect(parseMoment("412")).toBeNull();
    expect(parseMoment("")).toBeNull();
  });
});

describe("summary gist", () => {
  it("splits off the first sentence of a Polish summary", () => {
    expect(
      summaryGist(
        "Modele językowe częściej zmieniają sposób pracy niż samą pracę. Badaczka AI i analityk rynku pracy widzą to najszybciej.",
        "pl",
      ),
    ).toEqual({
      gist: "Modele językowe częściej zmieniają sposób pracy niż samą pracę.",
      rest: "Badaczka AI i analityk rynku pracy widzą to najszybciej.",
    });
  });

  it("keeps a one-sentence summary whole and accepts an unknown language", () => {
    expect(summaryGist("The budget grows next year.", "not a language")).toEqual({
      gist: "The budget grows next year.",
      rest: "",
    });
    expect(summaryGist("Budget talks. Hiring next.", null).rest).toBe("Hiring next.");
  });
});
