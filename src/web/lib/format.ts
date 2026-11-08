import type { TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  const units = ["B", "KiB", "MiB", "GiB"];
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** exponent)} ${units[exponent]}`;
}

export const formatImportDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);

export const formatChangeTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);

const backendNames: Record<string, string> = {
  cpu: "CPU",
  cuda: "CUDA",
  metal: "Metal",
  rocm: "ROCm",
  vulkan: "Vulkan",
};

export const formatDevice = (device: TranscriptionDevice) =>
  `${device.name} · ${backendNames[device.backend] ?? device.backend}`;
