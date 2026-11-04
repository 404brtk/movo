import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "../../../../src/web/lib/format.ts";

describe("media display formatting", () => {
  it.each([
    [0, "0:00"],
    [2.9, "0:02"],
    [61, "1:01"],
    [3601, "1:00:01"],
    [7265, "2:01:05"],
  ] as const)("formats duration %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KiB"],
    [1024 ** 2, "1 MiB"],
    [10 * 1024 ** 3, "10 GiB"],
  ] as const)("formats file size %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
