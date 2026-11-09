import { type DownloadJob, getDownloadPreset } from "../../shared/contracts/downloads.ts";
import type { StatusTone } from "./status-tone.ts";
import { formatByteProgress, formatBytes } from "./format.ts";

const runningLabels = {
  queued: "Starting",
  checking: "Checking source",
  downloading: "Downloading",
  processing: "Processing media",
  saving: "Saving to library",
  finished: "Finishing",
} satisfies Record<DownloadJob["phase"], string>;

export const isActiveDownload = (job: DownloadJob) =>
  job.status === "queued" || job.status === "running";

export const downloadTitle = (job: DownloadJob) =>
  job.title ?? job.url.replace(/^https?:\/\/(www\.)?/u, "");

export function describePreset(job: DownloadJob) {
  const preset = getDownloadPreset(job.preset);
  return `${preset.kind === "audio" ? "Audio" : "Video"} · ${preset.label.toLowerCase()}`;
}

export function downloadProgress(job: DownloadJob) {
  if (job.status !== "running" || job.phase !== "downloading" || job.totalBytes === null)
    return null;
  return Math.min(100, (job.downloadedBytes / job.totalBytes) * 100);
}

function receivedBytes(job: DownloadJob) {
  if (job.totalBytes !== null)
    return ` · ${formatByteProgress(job.downloadedBytes, job.totalBytes)}`;
  return job.downloadedBytes > 0 ? ` · ${formatBytes(job.downloadedBytes)}` : "";
}

interface DownloadState {
  tone: StatusTone;
  label: string;
}

const settledStates = {
  queued: { tone: "idle", label: "Waiting in queue" },
  completed: { tone: "success", label: "Saved to library" },
  failed: { tone: "danger", label: "Download failed" },
  cancelled: { tone: "idle", label: "Cancelled" },
  interrupted: { tone: "warning", label: "Interrupted when Movo closed" },
} satisfies Record<Exclude<DownloadJob["status"], "running">, DownloadState>;

export function describeDownload(job: DownloadJob): DownloadState {
  if (job.status !== "running") return settledStates[job.status];
  return {
    tone: "active",
    label:
      job.phase === "downloading"
        ? `${runningLabels.downloading}${receivedBytes(job)}`
        : runningLabels[job.phase],
  };
}
