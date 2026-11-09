import type { LibraryItem, LibraryQuery, LibrarySort } from "../../shared/contracts/library.ts";
import { formatBytes, formatDuration, formatSourceHost } from "./format.ts";

const dayInMs = 86_400_000;
const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthName = new Intl.DateTimeFormat("en-GB", { month: "long" });
const monthAndYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

const startOfDay = (timestamp: number) => new Date(timestamp).setHours(0, 0, 0, 0);
const sameYear = (first: number, second: number) =>
  new Date(first).getFullYear() === new Date(second).getFullYear();

function startOfWeek(now: number) {
  const day = new Date(startOfDay(now));
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

export function formatImportDay(timestamp: number, now = Date.now()) {
  const daysAgo = Math.round((startOfDay(now) - startOfDay(timestamp)) / dayInMs);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const date = new Date(timestamp);
  const day = `${date.getDate()} ${shortMonth.format(date)}`;
  return sameYear(timestamp, now) ? day : `${day} ${date.getFullYear()}`;
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export function formatDayAndTime(timestamp: number, separator = ", ", now = Date.now()) {
  const day = formatImportDay(timestamp, now);
  const relative = day === "Today" || day === "Yesterday";
  return `${relative ? day.toLowerCase() : day}${separator}${clock.format(timestamp)}`;
}

export function importPeriod(timestamp: number, now = Date.now()) {
  if (timestamp >= startOfWeek(now)) return "This week";
  if (!sameYear(timestamp, now)) return monthAndYear.format(timestamp);
  return new Date(timestamp).getMonth() === new Date(now).getMonth()
    ? `Earlier in ${monthName.format(timestamp)}`
    : monthName.format(timestamp);
}

export function groupByImportPeriod<Item extends { importedAt: number }>(
  items: readonly Item[],
  now = Date.now(),
) {
  const groups: { label: string; items: Item[] }[] = [];
  for (const item of items) {
    const label = importPeriod(item.importedAt, now);
    const current = groups.at(-1);
    if (current?.label === label) current.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function describeMedia(item: LibraryItem, { detailed }: { detailed: boolean }) {
  const source = item.sourceUrl ? formatSourceHost(item.sourceUrl) : null;
  return [
    formatDuration(item.durationSeconds),
    detailed
      ? item.fileRemovedAt === null
        ? formatBytes(item.byteSize)
        : "Saved copy removed"
      : null,
    formatImportDay(item.importedAt),
    detailed ? source : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const sortLabels: Record<LibrarySort, string> = {
  relevance: "Best match",
  newest: "Newest",
  oldest: "Oldest",
  title: "Title",
};

const kindNouns = { audio: "audio recordings", video: "videos" } as const;
const otherKinds = { audio: "videos", video: "audio recordings" } as const;
const transcriptAdjectives = { available: "transcribed", missing: "untranscribed" } as const;

export function describeNoMatches({ q, kind, transcript }: LibraryQuery) {
  const noun = [
    transcript ? transcriptAdjectives[transcript] : null,
    kind ? kindNouns[kind] : "recordings",
  ]
    .filter(Boolean)
    .join(" ");
  const query = q?.trim();
  if (!query)
    return {
      title: `No ${noun} match these filters`,
      description: "Clear the filters to see every recording.",
    };
  const widen = kind
    ? `include ${otherKinds[kind]} too`
    : transcript
      ? "include recordings with any transcript"
      : null;
  return {
    title: `No ${noun} match “${query}”`,
    description: widen
      ? `Check the spelling, try other words, or ${widen}.`
      : "Check the spelling or try other words.",
  };
}
