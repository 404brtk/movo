import { describe, expect, it } from "vitest";
import { bulkTagState, showsTagNames, tagMatchRanges } from "../../../../src/web/lib/tags.ts";

describe("library tag presentation", () => {
  it("switches to a count for three tags or names that exceed the row budget", () => {
    const short = { name: "Interview" };
    expect(showsTagNames([short, short])).toBe(true);
    expect(showsTagNames([short, short, short])).toBe(false);
    expect(showsTagNames([{ name: "a".repeat(27) }])).toBe(false);
  });

  it("highlights matching word prefixes in the original name", () => {
    expect(tagMatchRanges("Łódź Meeting", "me lod")).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 7 },
    ]);
  });

  it("counts recordings that already have a tag", () => {
    const tag = { id: "one", name: "Interview", color: "gray" } as const;
    expect(bulkTagState([{ tags: [tag] }, { tags: [] }], tag.id)).toEqual({
      state: "some",
      count: 1,
    });
    expect(bulkTagState([{ tags: [tag] }], tag.id)).toEqual({ state: "all", count: 1 });
    expect(bulkTagState([{ tags: [] }], tag.id)).toEqual({ state: "none", count: 0 });
  });
});
