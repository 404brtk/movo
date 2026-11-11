import type {
  TranscriptPatch,
  TranscriptWord,
  WordReplacement,
} from "./contracts/transcriptions.ts";

const edgePunctuation = /^(\p{P}*)(.*?)(\p{P}*)$/su;

export const wordTokens = (text: string) => text.split(/\s+/u).filter(Boolean);

const sameWord = (first: TranscriptWord, second: TranscriptWord) =>
  first.startMs === second.startMs &&
  first.endMs === second.endMs &&
  first.text === second.text &&
  first.speaker === second.speaker;

const wordOrder = (first: TranscriptWord, second: TranscriptWord) =>
  first.startMs - second.startMs ||
  first.endMs - second.endMs ||
  (first.text < second.text ? -1 : first.text > second.text ? 1 : 0) ||
  (first.speaker ?? 0) - (second.speaker ?? 0);

const spokenBy = (speaker: number | undefined) => (speaker === undefined ? {} : { speaker });

function edges(text: string) {
  const [, leading = "", core = "", trailing = ""] = edgePunctuation.exec(text) ?? [];
  return { leading, core, trailing };
}

const matchKey = (text: string) => (edges(text).core || text).toLowerCase();

function retimedReplacement(
  words: readonly TranscriptWord[],
  firstWord: number,
  removedCount: number,
  texts: readonly string[],
): WordReplacement {
  const removed = words.slice(firstWord, firstWord + removedCount);
  if (texts.length === removed.length)
    return {
      firstWord,
      removed,
      inserted: removed.map((word, index) => ({ ...word, text: texts[index] ?? word.text })),
    };
  const next = words[firstWord + removedCount];
  const latestStartMs = next?.startMs ?? Number.POSITIVE_INFINITY;
  const startMs = Math.min(
    removed[0]?.startMs ?? words[firstWord - 1]?.endMs ?? next?.startMs ?? 0,
    latestStartMs,
  );
  const endMs = removed.reduce(
    (latest, word) => Math.max(latest, word.endMs),
    removed.length > 0 ? startMs : (next?.startMs ?? startMs),
  );
  const characters = texts.reduce((total, text) => total + text.length, 0);
  const at = (offset: number) => Math.round(startMs + ((endMs - startMs) * offset) / characters);
  const speaker = spokenBy(removed[0]?.speaker ?? words[firstWord - 1]?.speaker ?? next?.speaker);
  let offset = 0;
  return {
    firstWord,
    removed,
    inserted: texts.map((text) => {
      const wordStartMs = Math.min(at(offset), latestStartMs);
      offset += text.length;
      return { startMs: wordStartMs, endMs: at(offset), text, ...speaker };
    }),
  };
}

export function editWords(
  words: readonly TranscriptWord[],
  firstWord: number,
  wordCount: number,
  text: string,
): TranscriptPatch {
  const texts = wordTokens(text);
  const current = words.slice(firstWord, firstWord + wordCount);
  let prefix = 0;
  while (prefix < Math.min(current.length, texts.length) && current[prefix]?.text === texts[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(current.length, texts.length) - prefix &&
    current[current.length - 1 - suffix]?.text === texts[texts.length - 1 - suffix]
  )
    suffix++;
  const removedCount = current.length - prefix - suffix;
  const inserted = texts.slice(prefix, texts.length - suffix);
  if (removedCount === 0 && inserted.length === 0) return [];
  return [retimedReplacement(words, firstWord + prefix, removedCount, inserted)];
}

function keepEdgePunctuation(texts: readonly string[], matched: readonly TranscriptWord[]) {
  const leading = edges(matched[0]?.text ?? "").leading;
  const trailing = edges(matched.at(-1)?.text ?? "").trailing;
  return texts.map(
    (text, index) =>
      (index === 0 ? leading : "") + text + (index === texts.length - 1 ? trailing : ""),
  );
}

export function findWords(words: readonly TranscriptWord[], find: string) {
  const pattern = wordTokens(find).map(matchKey);
  if (pattern.length === 0) return [];
  const keys = words.map((word) => matchKey(word.text));
  const ranges: { firstWord: number; wordCount: number }[] = [];
  let index = 0;
  while (index + pattern.length <= words.length) {
    if (!pattern.every((key, offset) => keys[index + offset] === key)) {
      index++;
      continue;
    }
    ranges.push({ firstWord: index, wordCount: pattern.length });
    index += pattern.length;
  }
  return ranges;
}

export function replaceWords(
  words: readonly TranscriptWord[],
  find: string,
  replacement: string,
): TranscriptPatch {
  const replacementTexts = wordTokens(replacement);
  return findWords(words, find).flatMap(({ firstWord, wordCount }) => {
    const matched = words.slice(firstWord, firstWord + wordCount);
    const texts = keepEdgePunctuation(replacementTexts, matched);
    return texts.length === matched.length && texts.every((text, at) => text === matched[at]?.text)
      ? []
      : [retimedReplacement(words, firstWord, wordCount, texts)];
  });
}

function respeak(
  words: readonly TranscriptWord[],
  firstWord: number,
  end: number,
  changes: (word: TranscriptWord) => boolean,
  speaker: number,
): TranscriptPatch {
  const patch: { firstWord: number; removed: TranscriptWord[]; inserted: TranscriptWord[] }[] = [];
  for (let index = firstWord; index < end; index++) {
    const word = words[index];
    if (!word || !changes(word)) continue;
    let run = patch.at(-1);
    if (!run || run.firstWord + run.removed.length !== index) {
      run = { firstWord: index, removed: [], inserted: [] };
      patch.push(run);
    }
    run.removed.push(word);
    run.inserted.push({ ...word, speaker });
  }
  return patch;
}

export const assignSpeaker = (
  words: readonly TranscriptWord[],
  firstWord: number,
  wordCount: number,
  speaker: number,
) =>
  respeak(
    words,
    firstWord,
    Math.min(firstWord + wordCount, words.length),
    (word) => word.speaker !== speaker,
    speaker,
  );

export const mergeSpeaker = (words: readonly TranscriptWord[], speaker: number, into: number) =>
  respeak(words, 0, words.length, (word) => word.speaker === speaker, into);

export function applyPatch(words: readonly TranscriptWord[], patch: TranscriptPatch) {
  const result: TranscriptWord[] = [];
  let copied = 0;
  const copyUntil = (end: number) => {
    for (let index = copied; index < end; index++) {
      const word = words[index];
      if (word) result.push(word);
    }
  };
  for (const { firstWord, removed, inserted } of patch) {
    if (
      firstWord < copied ||
      firstWord + removed.length > words.length ||
      removed.some((word, offset) => {
        const current = words[firstWord + offset];
        return !current || !sameWord(word, current);
      })
    )
      throw new Error("The change does not match the transcript it applies to.");
    copyUntil(firstWord);
    for (const word of inserted) result.push(word);
    copied = firstWord + removed.length;
  }
  copyUntil(words.length);
  return result;
}

export function invertPatch(patch: TranscriptPatch): TranscriptPatch {
  let shift = 0;
  return patch.map(({ firstWord, removed, inserted }) => {
    const inverse = { firstWord: firstWord + shift, removed: inserted, inserted: removed };
    shift += inserted.length - removed.length;
    return inverse;
  });
}

export function diffWords(
  before: readonly TranscriptWord[],
  after: readonly TranscriptWord[],
): TranscriptPatch {
  const patch: WordReplacement[] = [];
  let removedUntil = 0;
  let insertedUntil = 0;
  const matches = () => {
    const removed = before[removedUntil];
    const inserted = after[insertedUntil];
    return removed !== undefined && inserted !== undefined && sameWord(removed, inserted);
  };
  while (removedUntil < before.length || insertedUntil < after.length) {
    if (matches()) {
      removedUntil++;
      insertedUntil++;
      continue;
    }
    const firstWord = removedUntil;
    const firstInserted = insertedUntil;
    while ((removedUntil < before.length || insertedUntil < after.length) && !matches()) {
      const removed = before[removedUntil];
      const inserted = after[insertedUntil];
      if (removed && (!inserted || wordOrder(removed, inserted) < 0)) removedUntil++;
      else insertedUntil++;
    }
    patch.push({
      firstWord,
      removed: before.slice(firstWord, removedUntil),
      inserted: after.slice(firstInserted, insertedUntil),
    });
  }
  return patch;
}
