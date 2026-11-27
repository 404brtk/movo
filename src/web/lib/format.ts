import type { TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";

export { formatDuration } from "../../shared/duration.ts";

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

export const formatToolVersion = (version: string) =>
  /^n?(\d+(?:\.\d+)+)/u.exec(version)?.[1] ?? "dev build";

const backendNames: Record<string, string> = {
  cpu: "CPU",
  cuda: "CUDA",
  metal: "Metal",
  rocm: "ROCm",
  vulkan: "Vulkan",
};

export const formatDevice = (device: TranscriptionDevice) =>
  `${device.name} (${backendNames[device.backend] ?? device.backend})`;

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMs = 86_400_000;

export function formatDay(timestamp: number, now = Date.now()) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (timestamp >= startOfToday) return "Today";
  if (timestamp >= startOfToday - dayMs) return "Yesterday";
  return dayFormat.format(timestamp);
}
