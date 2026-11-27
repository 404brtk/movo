import { describe, expect, it } from "vitest";
import { chapterTitle, normalizeSiteChapters } from "../../../../src/server/overview/chapters.ts";

describe("chapters from the source site", () => {
  it("keeps titled chapters inside the recording in time order without duplicates", () => {
    expect(
      normalizeSiteChapters(
        [
          { start_time: 130.4, title: "  Dlaczego\tSQLite " },
          { start_time: 0, title: "Intro" },
          { start_time: 130.4, title: "Duplicate start" },
          { start_time: 200, title: "" },
          { start_time: 210, title: null },
          { start_time: 220 },
          { start_time: -1, title: "Before the start" },
          { start_time: 600, title: "After the end" },
          { start_time: Number.NaN, title: "Broken" },
        ],
        600,
      ),
    ).toEqual([
      { startMs: 0, title: "Intro" },
      { startMs: 130_400, title: "Dlaczego SQLite" },
    ]);
  });

  it("drops a single remaining chapter and missing chapters", () => {
    expect(normalizeSiteChapters([{ start_time: 0, title: "Only one" }], 60)).toEqual([]);
    expect(normalizeSiteChapters(undefined, 60)).toEqual([]);
    expect(normalizeSiteChapters(null, 60)).toEqual([]);
  });

  it("shortens long titles on a word boundary", () => {
    const title = chapterTitle(`${"słowo ".repeat(40)}koniec`);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).toMatch(/słowo…$/u);
  });
});
