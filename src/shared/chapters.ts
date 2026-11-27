import { formatDuration } from "./duration.ts";

type Timed = { startMs: number };

export function currentChapterIndex(chapters: readonly Timed[], positionMs: number) {
  let current = -1;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.startMs > positionMs) break;
    current = index;
  }
  return current;
}

export interface ChapterRange<Chapter extends Timed = Timed & { id: string; title: string }> {
  chapter: Chapter;
  startMs: number;
  endMs: number;
}

export function chapterRanges<Chapter extends Timed>(
  chapters: readonly Chapter[],
  durationMs: number,
): ChapterRange<Chapter>[] {
  return chapters.map((chapter, index) => ({
    chapter,
    startMs: chapter.startMs,
    endMs: Math.max(chapter.startMs, chapters[index + 1]?.startMs ?? durationMs),
  }));
}

export const formatMoment = (milliseconds: number) => formatDuration(milliseconds / 1000);

export function parseMoment(text: string, originalMs?: number) {
  if (originalMs !== undefined && text.trim() === formatMoment(originalMs)) return originalMs;
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/u.exec(text.trim());
  if (!match) return null;
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  if (Number(seconds) > 59 || (match[1] !== undefined && Number(minutes) > 59)) return null;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

export const timedLines = (items: readonly (Timed & { text: string })[]) =>
  items.map((item) => `${formatMoment(item.startMs)} ${item.text}`).join("\n");

export const videoDescriptionChapters = (chapters: readonly (Timed & { title: string })[]) =>
  timedLines(chapters.map((chapter) => ({ startMs: chapter.startMs, text: chapter.title })));

function sentenceLocale(language: string | null | undefined) {
  if (!language) return undefined;
  try {
    return Intl.Segmenter.supportedLocalesOf(language)[0];
  } catch {
    return undefined;
  }
}

export function summaryGist(text: string, language?: string | null) {
  const trimmed = text.trim();
  const [first] = new Intl.Segmenter(sentenceLocale(language), { granularity: "sentence" }).segment(
    trimmed,
  );
  const gist = (first?.segment ?? trimmed).trim();
  return { gist, rest: trimmed.slice(first?.segment.length ?? trimmed.length).trim() };
}
