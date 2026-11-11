import { describe, expect, it } from "vitest";
import type { LibraryItem } from "../../../../src/shared/contracts/library.ts";
import {
  describeMedia,
  describeNoMatches,
  formatImportDay,
  groupByImportPeriod,
  importPeriod,
} from "../../../../src/web/lib/library-view.ts";

const now = new Date(2026, 9, 14, 12).getTime();
const at = (year: number, month: number, day: number, hour = 9) =>
  new Date(year, month - 1, day, hour).getTime();

const item: LibraryItem = {
  id: "8f7f2c1e-5a43-4c1b-9b8e-3a2d1c0b9a87",
  title: "How attention works — Lecture 3",
  originalName: "lecture-3.m4a",
  kind: "audio",
  contentType: "audio/mp4",
  byteSize: 74 * 1024 ** 2,
  durationSeconds: 4868,
  importedAt: at(2026, 10, 10),
  sourceUrl: "https://www.youtube.com/watch?v=8pDqJVdNa44",
  fileRemovedAt: null,
  transcription: "done",
};

describe("library import dates", () => {
  it.each([
    [at(2026, 10, 14, 0), "Today"],
    [at(2026, 10, 13, 23), "Yesterday"],
    [at(2026, 10, 10), "10 Oct"],
    [at(2026, 9, 21), "21 Sep"],
    [at(2025, 12, 1), "1 Dec 2025"],
  ] as const)("names the day of %s", (timestamp, expected) => {
    expect(formatImportDay(timestamp, now)).toBe(expected);
  });

  it.each([
    [at(2026, 10, 8, 0), "Last 7 days"],
    [at(2026, 10, 7, 23), "Earlier in October"],
    [at(2026, 9, 29), "September"],
    [at(2025, 12, 1), "December 2025"],
  ] as const)("names the period of %s", (timestamp, expected) => {
    expect(importPeriod(timestamp, now)).toBe(expected);
  });

  it("groups consecutive items that share a period", () => {
    const items = [at(2026, 10, 14), at(2026, 10, 13), at(2026, 10, 3), at(2026, 9, 21)].map(
      (importedAt) => ({ importedAt }),
    );
    expect(
      groupByImportPeriod(items, now).map((group) => [group.label, group.items.length]),
    ).toEqual([
      ["Last 7 days", 2],
      ["Earlier in October", 1],
      ["September", 1],
    ]);
  });
});

describe("library item details", () => {
  it("lists duration, size, day and source when detailed", () => {
    expect(describeMedia(item, { detailed: true })).toMatch(
      /^1:21:08 · 74 MiB · \d+ \w+( \d{4})? · youtube\.com$/u,
    );
  });

  it("keeps search results to duration and day", () => {
    expect(describeMedia({ ...item, sourceUrl: null }, { detailed: false })).toMatch(
      /^1:21:08 · \S/u,
    );
  });

  it("says when the saved copy was removed", () => {
    expect(
      describeMedia({ ...item, fileRemovedAt: at(2026, 10, 11) }, { detailed: true }),
    ).toContain("· Saved copy removed ·");
  });
});

describe("no matches copy", () => {
  it.each([
    [
      { q: "kubernetes", kind: "video" },
      "No videos match “kubernetes”",
      "Check the spelling, try other words, or include audio recordings too.",
    ],
    [{ q: " plan " }, "No recordings match “plan”", "Check the spelling or try other words."],
    [
      { q: "plan", transcript: "missing" },
      "No untranscribed recordings match “plan”",
      "Check the spelling, try other words, or include recordings with any transcript.",
    ],
    [
      { kind: "audio", transcript: "available" },
      "No transcribed audio recordings match these filters",
      "Clear the filters to see every recording.",
    ],
  ] as const)("describes %o", (search, title, description) => {
    expect(describeNoMatches(search)).toEqual({ title, description });
  });
});
