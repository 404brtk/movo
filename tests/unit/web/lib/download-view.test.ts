import { describe, expect, it } from "vitest";
import type { DownloadJob } from "../../../../src/shared/contracts/downloads.ts";
import {
  describeDownload,
  describePreset,
  downloadProgress,
  downloadTitle,
} from "../../../../src/web/lib/download-view.ts";

const MiB = 1024 * 1024;
const job: DownloadJob = {
  id: "8f7f2c1e-5a43-4c1b-9b8e-3a2d1c0b9a87",
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  preset: "video-720p",
  transcribe: false,
  title: null,
  durationSeconds: null,
  status: "running",
  phase: "downloading",
  downloadedBytes: 48 * MiB,
  totalBytes: 64 * MiB,
  error: null,
  cleanupError: null,
  mediaId: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("download view", () => {
  it("describes a running download with its share of the expected size", () => {
    expect(downloadTitle(job)).toBe("youtube.com/watch?v=aaaaaaaaaaa");
    expect(describePreset(job)).toBe("Video · up to 720p");
    expect(describeDownload(job)).toEqual({
      tone: "active",
      label: `Downloading · ${(48).toLocaleString()} of ${(64).toLocaleString()} MiB`,
    });
    expect(downloadProgress(job)).toBe(75);
  });

  it("falls back to received bytes and caps an underestimated size", () => {
    expect(describeDownload({ ...job, totalBytes: null }).label).toBe(
      `Downloading · ${(48).toLocaleString()} MiB`,
    );
    expect(downloadProgress({ ...job, totalBytes: null })).toBeNull();
    expect(downloadProgress({ ...job, totalBytes: 32 * MiB })).toBe(100);
  });

  it("names settled states and phases without byte counts", () => {
    expect(describeDownload({ ...job, phase: "checking" })).toEqual({
      tone: "active",
      label: "Checking source",
    });
    expect(describeDownload({ ...job, status: "interrupted", phase: "finished" })).toEqual({
      tone: "warning",
      label: "Interrupted when Movo closed",
    });
    expect(downloadProgress({ ...job, status: "failed" })).toBeNull();
  });
});
