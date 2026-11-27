import {
  type DownloadJob,
  type DownloadPreset,
  type DownloadPreview,
  type DownloadLinkRequest,
  type DownloadRequest,
  getDownloadPreset,
  maxDownloadRequestBytes,
  retryableDownloadStates,
} from "../../shared/contracts/downloads.ts";
import {
  type DownloadSource,
  isAudioOnlySite,
  recognizeDownloadSource,
  recognizeYouTubeCollection,
  type YouTubeCollection,
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

export type CollectionOffer = { source: YouTubeCollection; fromWatch: boolean };

export const countLabel = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

export function* downloadRequestBatches(request: DownloadRequest): Iterable<DownloadRequest> {
  const encoder = new TextEncoder();
  const emptyRequest = { ...request, links: [] };
  const overhead = encoder.encode(JSON.stringify(emptyRequest)).byteLength;
  let links: DownloadLinkRequest[] = [];
  let bytes = overhead;
  for (const link of request.links) {
    const linkBytes = encoder.encode(JSON.stringify(link)).byteLength;
    if (overhead + linkBytes > maxDownloadRequestBytes)
      throw new Error("A download link is too large to send.");
    if (bytes + 1 + linkBytes > maxDownloadRequestBytes && links.length > 0) {
      yield { ...emptyRequest, links };
      links = [];
      bytes = overhead;
    }
    bytes += linkBytes + (links.length > 0 ? 1 : 0);
    links.push(link);
  }
  if (links.length > 0) yield { ...emptyRequest, links };
}

export function addLinks(rows: readonly LinkRow[], text: string, kind: SaveKind) {
  const inputs = text.split(/\s+/u).filter(Boolean);
  const rowKeys = new Set(rows.map((row) => row.key));
  const added: LinkRow[] = [];
  const collections = new Map<string, CollectionOffer>();
  const notLinks: string[] = [];
  let duplicates = 0;
  let standaloneMix = false;
  for (const input of inputs) {
    if (!/^https?:\/\//iu.test(input)) {
      notLinks.push(input);
      continue;
    }
    const source = recognizeDownloadSource(input);
    const collection = recognizeYouTubeCollection(input);
    if (collection?.kind === "mix" && !source) {
      standaloneMix = true;
      continue;
    }
    if (collection && collection.kind !== "mix") {
      collections.set(collection.url, { source: collection, fromWatch: Boolean(source) });
      if (!source) continue;
    }
    const key = source?.url ?? input;
    if (rowKeys.has(key)) duplicates++;
    else {
      rowKeys.add(key);
      added.push({ key, input, source, kind });
    }
  }
  const collection = [...collections.values()][0];
  const note =
    notLinks.length > 0
      ? "Paste full links that start with https://."
      : duplicates > 0 && added.length === 0
        ? "Already in the list."
        : null;
  return {
    rows: [...rows, ...added],
    collections: [...collections.values()],
    openCollection: inputs.length === 1 && !collection?.fromWatch ? collection?.source : undefined,
    remaining: notLinks.join(" "),
    note: standaloneMix
      ? `This is a YouTube Mix. Paste a link to a specific video.${note ? ` ${note}` : ""}`
      : note,
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
  preview: { error: Error | null; data?: DownloadPreview | undefined },
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
  const savedId =
    preview.data?.saved.find((saved) => saved.preset === preset)?.mediaId ??
    (existing?.status === "completed" ? existing.mediaId : null);
  if (savedId)
    return {
      reason: "saved",
      tone: "idle",
      message: `Already saved as ${getDownloadPreset(preset).kind}`,
      mediaId: savedId,
    };
  if (!existing || retryableDownloadStates.has(existing.status)) return null;
  return { reason: "queued", tone: "idle", message: "Already in Downloads" };
}

export const linkTitle = (row: LinkRow, preview: DownloadPreview | undefined) =>
  preview?.title ?? row.input.replace(/^https?:\/\/(www\.)?/iu, "");
