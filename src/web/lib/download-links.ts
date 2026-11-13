import {
  type DownloadJob,
  type DownloadPreset,
  type DownloadPreview,
  getDownloadPreset,
  maxDownloadLinks,
} from "../../shared/contracts/downloads.ts";
import {
  type DownloadSource,
  isAudioOnlySite,
  recognizeDownloadSource,
} from "../../shared/download-sources.ts";
import type { StatusTone } from "./status-tone.ts";
import { formatSourceHost } from "./format.ts";

export type SaveKind = "video" | "audio";

export interface LinkRow {
  key: string;
  input: string;
  source: DownloadSource | undefined;
  kind: SaveKind;
}

export const countLabel = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

export function addLinks(rows: readonly LinkRow[], text: string, kind: SaveKind) {
  const added: LinkRow[] = [];
  const notLinks: string[] = [];
  const later: string[] = [];
  let duplicates = 0;
  for (const input of text.split(/\s+/u).filter(Boolean)) {
    if (!/^https?:\/\//iu.test(input)) {
      notLinks.push(input);
      continue;
    }
    const source = recognizeDownloadSource(input);
    const key = source?.url ?? input;
    if ([...rows, ...added].some((row) => row.key === key)) duplicates++;
    else if (rows.length + added.length >= maxDownloadLinks) later.push(input);
    else added.push({ key, input, source, kind });
  }
  return {
    rows: [...rows, ...added],
    remaining: [...notLinks, ...later].join(" "),
    note:
      notLinks.length > 0
        ? "Paste full links that start with https://."
        : later.length > 0
          ? "The rest are added after you download these."
          : duplicates > 0 && added.length === 0
            ? "Already in the list."
            : null,
  };
}

export const canChooseKind = (row: LinkRow) =>
  row.source !== undefined && !isAudioOnlySite(row.source.site);

export const linkPreset = (row: LinkRow, videoPreset: DownloadPreset): DownloadPreset =>
  canChooseKind(row) && row.kind === "video" ? videoPreset : "audio";

export type LinkSkip =
  | { reason: "unsupported" | "unavailable" | "queued"; tone: StatusTone; message: string }
  | { reason: "saved"; tone: StatusTone; message: string; mediaId: string };

export function linkSkip(
  row: LinkRow,
  preset: DownloadPreset,
  preview: { error: Error | null },
  jobs: readonly DownloadJob[],
): LinkSkip | null {
  if (!row.source)
    return {
      reason: "unsupported",
      tone: "danger",
      message: `${formatSourceHost(row.input) ?? "This site"} isn’t supported`,
    };
  if (preview.error)
    return { reason: "unavailable", tone: "warning", message: preview.error.message };
  const url = row.source.url;
  const existing = jobs.find((job) => job.url === url && job.preset === preset);
  if (!existing) return null;
  if (existing.status === "completed" && existing.mediaId)
    return {
      reason: "saved",
      tone: "idle",
      message: `Already saved as ${getDownloadPreset(preset).kind}`,
      mediaId: existing.mediaId,
    };
  return { reason: "queued", tone: "idle", message: "Already in Downloads" };
}

export const linkTitle = (row: LinkRow, preview: DownloadPreview | undefined) =>
  preview?.title ?? row.input.replace(/^https?:\/\/(www\.)?/iu, "");
