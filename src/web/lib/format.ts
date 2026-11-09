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

const byteUnits = ["B", "KiB", "MiB", "GiB"] as const;
const byteExponent = (bytes: number) =>
  bytes < 1024 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), byteUnits.length - 1);
const formatScaled = (bytes: number, exponent: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, useGrouping: false }).format(
    bytes / 1024 ** exponent,
  );

export function formatBytes(bytes: number) {
  const exponent = byteExponent(bytes);
  return `${formatScaled(bytes, exponent)} ${byteUnits[exponent]}`;
}

export function formatByteProgress(bytes: number, totalBytes: number) {
  const exponent = byteExponent(totalBytes);
  return `${formatScaled(bytes, exponent)} of ${formatScaled(totalBytes, exponent)} ${byteUnits[exponent]}`;
}

export const formatSourceHost = (url: string) =>
  URL.parse(url)?.hostname.replace(/^www\./u, "") ?? null;

const backendNames: Record<string, string> = {
  cpu: "CPU",
  cuda: "CUDA",
  metal: "Metal",
  rocm: "ROCm",
  vulkan: "Vulkan",
};

export const formatDevice = (device: TranscriptionDevice) =>
  `${device.name} · ${backendNames[device.backend] ?? device.backend}`;
