import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDay,
  formatDevice,
  formatDuration,
} from "../../../../src/web/lib/format.ts";

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
  it.each([
    [{ backend: "vulkan", name: "Test GPU" }, "Test GPU · Vulkan"],
    [{ backend: "cpu", name: "Test CPU" }, "Test CPU · CPU"],
    [{ backend: "future", name: "Accelerator" }, "Accelerator · future"],
  ] as const)("formats transcription device %o", (device, expected) => {
    expect(formatDevice(device)).toBe(expected);
  });
});

it("names recent days and dates older ones", () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime();
  expect(formatDay(new Date(2026, 10, 10, 0, 5).getTime(), now)).toBe("Today");
  expect(formatDay(new Date(2026, 10, 9, 23, 59).getTime(), now)).toBe("Yesterday");
  expect(formatDay(new Date(2026, 9, 14, 12, 0).getTime(), now)).toBe("14 Oct");
});
