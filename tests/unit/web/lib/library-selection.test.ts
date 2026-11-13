import { describe, expect, it } from "vitest";
import {
  describeBulkDeletion,
  recordingCount,
  toggleSelection,
} from "../../../../src/web/lib/library-selection.ts";

const order = ["a", "b", "c", "d", "e"];
const sorted = (set: ReadonlySet<string>) => [...set].toSorted();

describe("toggleSelection", () => {
  it("toggles a single row without an anchor or modifier", () => {
    expect(sorted(toggleSelection(new Set(), order, "c", null, false))).toEqual(["c"]);
    expect(sorted(toggleSelection(new Set(["c"]), order, "c", "c", false))).toEqual([]);
    expect(sorted(toggleSelection(new Set(["a"]), order, "d", "a", false))).toEqual(["a", "d"]);
  });

  it("extends from the anchor in either direction, inclusive", () => {
    expect(sorted(toggleSelection(new Set(["b"]), order, "d", "b", true))).toEqual(["b", "c", "d"]);
    expect(sorted(toggleSelection(new Set(["d"]), order, "a", "d", true))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("clears a range when the clicked row was already selected", () => {
    expect(sorted(toggleSelection(new Set(order), order, "d", "b", true))).toEqual(["a", "e"]);
  });

  it("falls back to a single toggle when the anchor is no longer listed", () => {
    expect(sorted(toggleSelection(new Set(["x"]), order, "c", "x", true))).toEqual(["c", "x"]);
  });

  it("leaves the given set untouched", () => {
    const selected = new Set(["a"]);
    toggleSelection(selected, order, "b", "a", true);
    expect(sorted(selected)).toEqual(["a"]);
  });
});

describe("describeBulkDeletion", () => {
  it("names the single recording that was not deleted", () => {
    expect(
      describeBulkDeletion(3, [
        { title: "Interview", message: "Cancel the transcription before deleting this recording." },
      ]),
    ).toBe(
      "Deleted 2 of 3. “Interview” was not deleted: Cancel the transcription before deleting this recording.",
    );
  });

  it("lists every failure and omits the summary when nothing was deleted", () => {
    expect(
      describeBulkDeletion(2, [
        { title: "One", message: "Busy." },
        { title: "Two", message: "Locked." },
      ]),
    ).toBe("2 recordings were not deleted. “One”: Busy. “Two”: Locked.");
  });
});

describe("recordingCount", () => {
  it("uses the singular for one recording", () => {
    expect(recordingCount(1)).toBe("1 recording");
    expect(recordingCount(4)).toBe("4 recordings");
  });
});
