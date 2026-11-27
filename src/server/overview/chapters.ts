import { maxChapterTitleCharacters } from "../../shared/contracts/overview.ts";

export interface SiteChapter {
  start_time: number;
  title?: string | null | undefined;
}

export function chapterTitle(text: string) {
  const single = text.replace(/[\p{Cc}\s]+/gu, " ").trim();
  if (single.length <= maxChapterTitleCharacters) return single;
  const cut = single.slice(0, maxChapterTitleCharacters - 1);
  const wordEnd = cut.lastIndexOf(" ");
  return `${(wordEnd > maxChapterTitleCharacters / 2 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}

export function uniqueByStart<Item extends { startMs: number }>(items: readonly Item[]) {
  const seen = new Set<number>();
  return items
    .toSorted((first, second) => first.startMs - second.startMs)
    .filter((item) => !seen.has(item.startMs) && seen.add(item.startMs));
}

export function normalizeSiteChapters(
  raw: readonly SiteChapter[] | null | undefined,
  durationSeconds: number,
) {
  const durationMs = durationSeconds * 1000;
  const chapters = uniqueByStart(
    (raw ?? []).flatMap((chapter) => {
      const title = chapterTitle(chapter.title ?? "");
      const startMs = Math.round(chapter.start_time * 1000);
      return title && Number.isFinite(startMs) && startMs >= 0 && startMs < durationMs
        ? [{ startMs, title }]
        : [];
    }),
  );
  return chapters.length < 2 ? [] : chapters;
}
