export type MomentIndex = ReadonlyMap<number, string>;

interface Citation {
  mediaId: string;
  startMs: number | undefined;
}

const codeSpans = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/u;
const citationPattern = /(?<!!)\[([^[\]\n]{1,120})\](?:\(([^()\s]{1,300})\))?/gu;
const mediaPath =
  /^(?:https?:\/\/)?\/?media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?startMs=(\d+))?$/iu;
const startMsList = /^\s*(?:startMs\s*[:=]?\s*)?\d{1,9}(?:\s*[,;\-\u2010-\u2013]\s*\d{1,9})*\s*$/iu;

export const momentHref = (mediaId: string, startMs?: number) =>
  startMs === undefined ? `/media/${mediaId}` : `/media/${mediaId}?startMs=${startMs}`;

function linkedCitation(href: string): Citation | null {
  const match = mediaPath.exec(href);
  const mediaId = match?.[1]?.toLowerCase();
  if (!match || !mediaId) return null;
  return { mediaId, startMs: match[2] === undefined ? undefined : Number(match[2]) };
}

function citationsIn(label: string, href: string | undefined, moments: MomentIndex) {
  if (href) {
    const linked = linkedCitation(href);
    return linked ? [linked] : [];
  }
  if (!startMsList.test(label)) return [];
  return (label.match(/\d+/gu) ?? []).flatMap((digits): Citation[] => {
    const startMs = Number(digits);
    const mediaId = moments.get(startMs);
    return mediaId ? [{ mediaId, startMs }] : [];
  });
}

const segments = (text: string) => text.split(codeSpans);
const isCode = (index: number) => index % 2 === 1;

export const normalizeCitations = (text: string, moments: MomentIndex) =>
  segments(text)
    .map((segment, index) =>
      isCode(index)
        ? segment
        : segment.replace(citationPattern, (whole, label: string, href?: string) => {
            const found = citationsIn(label, href, moments);
            if (found.length === 0) return whole;
            return found
              .map(
                (citation) =>
                  `[${href ? label : citation.startMs}](${momentHref(citation.mediaId, citation.startMs)})`,
              )
              .join(" ");
          }),
    )
    .join("");

export function citedMoments(text: string, moments: MomentIndex) {
  const groups = new Map<string, number[]>();
  segments(text).forEach((segment, index) => {
    if (isCode(index)) return;
    for (const [, label = "", href] of segment.matchAll(citationPattern))
      for (const citation of citationsIn(label, href, moments)) {
        const cited = groups.get(citation.mediaId) ?? [];
        if (citation.startMs !== undefined && !cited.includes(citation.startMs))
          cited.push(citation.startMs);
        groups.set(citation.mediaId, cited);
      }
  });
  return [...groups].map(([mediaId, cited]) => ({ mediaId, moments: cited }));
}
