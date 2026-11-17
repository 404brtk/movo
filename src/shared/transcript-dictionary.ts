import type { DictionaryDraft } from "./contracts/dictionary.ts";
import type { TranscriptWord } from "./contracts/transcriptions.ts";
import { foldSearchText } from "./search-text.ts";
import { edges, matchKey, replacedTexts, wordTokens, type WordRange } from "./transcript-edits.ts";

export const minSimilarLetters = 5;

export interface DictionaryMatch extends WordRange {
  entry: number;
  similar: boolean;
  replacement: readonly string[];
}

interface Candidate extends DictionaryMatch {
  exactness: number;
  distance: number;
}

export const phraseKey = (text: string) => wordTokens(text).map(matchKey).join(" ");
const letters = (text: string) => foldSearchText(text).replace(/\s+/gu, "");

export const allowedDistance = (spelling: string) => {
  const length = letters(spelling).length;
  if (length < minSimilarLetters) return 0;
  return length < 8 ? 1 : 2;
};

export const allowsSimilar = (spelling: string) => allowedDistance(spelling) > 0;

export const dictionaryKeys = (draft: Pick<DictionaryDraft, "spelling" | "alsoReplace">) => [
  phraseKey(draft.spelling),
  ...draft.alsoReplace.map(phraseKey),
];

export interface DictionaryProblem<Owner = unknown> {
  field: "spelling" | "similar" | "alsoReplace" | "neverChange";
  message: string;
  owner?: Owner;
}

const quoted = (text: string) => `“${text}”`;

export function findDictionaryProblem<
  Other extends Pick<DictionaryDraft, "spelling" | "alsoReplace">,
>(draft: DictionaryDraft, others: readonly Other[]): DictionaryProblem<Other> | undefined {
  const spelling = phraseKey(draft.spelling);
  const clash = (field: "spelling" | "alsoReplace", phrase: string) => {
    const owner = others.find((other) => dictionaryKeys(other).includes(phraseKey(phrase)));
    if (!owner) return undefined;
    const message =
      phraseKey(owner.spelling) === phraseKey(phrase)
        ? `${quoted(owner.spelling)} is already in the dictionary.`
        : `${quoted(phrase)} already becomes ${owner.spelling}.`;
    return { field, message, owner };
  };
  const spellingClash = clash("spelling", draft.spelling);
  if (spellingClash) return spellingClash;
  if (draft.similar && !allowsSimilar(draft.spelling))
    return {
      field: "similar",
      message: `Similar spellings need a word of at least ${minSimilarLetters} letters. List what the model hears under Also replace.`,
    };
  const replaced = new Set([spelling]);
  for (const variant of draft.alsoReplace) {
    const key = phraseKey(variant);
    if (key === spelling)
      return {
        field: "alsoReplace",
        message: `${quoted(variant)} is the spelling itself. Remove it from Also replace.`,
      };
    if (replaced.has(key))
      return {
        field: "alsoReplace",
        message: `${quoted(variant)} is listed twice under Also replace.`,
      };
    const variantClash = clash("alsoReplace", variant);
    if (variantClash) return variantClash;
    replaced.add(key);
  }
  const exceptions = new Set<string>();
  for (const exception of draft.neverChange) {
    const key = phraseKey(exception);
    if (key === spelling)
      return {
        field: "neverChange",
        message: `${quoted(exception)} is the spelling itself, so it can't be an exception.`,
      };
    if (replaced.has(key))
      return {
        field: "neverChange",
        message: `${quoted(exception)} is under Also replace, so it can't be an exception.`,
      };
    if (exceptions.has(key))
      return {
        field: "neverChange",
        message: `${quoted(exception)} is listed twice under Never change.`,
      };
    exceptions.add(key);
  }
  return undefined;
}

function distanceWithin(first: string, second: string, limit: number) {
  if (Math.abs(first.length - second.length) > limit) return limit + 1;
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row++) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= second.length; column++) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;
      let value = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        first[row - 1] === second[column - 2] &&
        first[row - 2] === second[column - 1]
      )
        value = Math.min(value, (beforePrevious[column - 2] ?? 0) + 1);
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > limit) return limit + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[second.length] ?? limit + 1;
}

function findDictionaryMatches(
  words: readonly TranscriptWord[],
  entries: readonly DictionaryDraft[],
): DictionaryMatch[] {
  const keys = words.map((word) => matchKey(word.text));
  const folded = words.map((word) => letters(edges(word.text).core || word.text));
  const joinsNext = words.map(
    (word, index) => !edges(word.text).trailing && !edges(words[index + 1]?.text ?? "").leading,
  );
  const spellings = new Set(entries.map((entry) => phraseKey(entry.spelling)));
  const windowKey = (firstWord: number, wordCount: number) =>
    keys.slice(firstWord, firstWord + wordCount).join(" ");
  const joined = (firstWord: number, wordCount: number) =>
    firstWord + wordCount <= words.length &&
    joinsNext.slice(firstWord, firstWord + wordCount - 1).every(Boolean);

  const occurrences = (pattern: readonly string[]) =>
    keys.flatMap((_, firstWord) =>
      firstWord + pattern.length <= words.length &&
      pattern.every((key, offset) => keys[firstWord + offset] === key)
        ? [firstWord]
        : [],
    );

  const candidates: Candidate[] = entries.flatMap((entry, index) => {
    const replacement = wordTokens(entry.spelling);
    const kept = new Uint8Array(words.length);
    for (const exception of entry.neverChange) {
      const pattern = wordTokens(exception).map(matchKey);
      for (const firstWord of occurrences(pattern))
        kept.fill(1, firstWord, firstWord + pattern.length);
    }
    const found: Candidate[] = [];
    const exactPhrases = [entry.spelling, ...entry.alsoReplace].map((phrase) =>
      wordTokens(phrase).map(matchKey),
    );
    for (const pattern of exactPhrases)
      for (const firstWord of occurrences(pattern))
        if (joined(firstWord, pattern.length))
          found.push({
            entry: index,
            firstWord,
            wordCount: pattern.length,
            similar: false,
            replacement,
            exactness: 0,
            distance: 0,
          });
    const limit = entry.similar ? allowedDistance(entry.spelling) : 0;
    if (limit > 0) {
      const target = letters(entry.spelling);
      const spellingKey = phraseKey(entry.spelling);
      const sizes = [replacement.length - 1, replacement.length, replacement.length + 1].filter(
        (size) => size > 0,
      );
      for (let firstWord = 0; firstWord < words.length; firstWord++)
        for (const wordCount of sizes) {
          if (!joined(firstWord, wordCount)) continue;
          const distance = distanceWithin(
            folded.slice(firstWord, firstWord + wordCount).join(""),
            target,
            limit,
          );
          if (distance > limit) continue;
          const key = windowKey(firstWord, wordCount);
          if (key === spellingKey || spellings.has(key)) continue;
          found.push({
            entry: index,
            firstWord,
            wordCount,
            similar: true,
            replacement,
            exactness: 1,
            distance,
          });
        }
    }
    return found.filter(
      (candidate) =>
        !kept
          .subarray(candidate.firstWord, candidate.firstWord + candidate.wordCount)
          .some(Boolean),
    );
  });

  const taken = new Uint8Array(words.length);
  return candidates
    .toSorted(
      (first, second) =>
        first.exactness - second.exactness ||
        second.wordCount - first.wordCount ||
        first.distance - second.distance ||
        first.firstWord - second.firstWord ||
        first.entry - second.entry,
    )
    .filter((candidate) => {
      const range = taken.subarray(candidate.firstWord, candidate.firstWord + candidate.wordCount);
      if (range.some(Boolean)) return false;
      range.fill(1);
      return true;
    })
    .toSorted((first, second) => first.firstWord - second.firstWord)
    .map(({ entry, firstWord, wordCount, similar, replacement }) => ({
      entry,
      firstWord,
      wordCount,
      similar,
      replacement,
    }));
}

export function dictionaryFixes(
  words: readonly TranscriptWord[],
  entries: readonly DictionaryDraft[],
) {
  return findDictionaryMatches(words, entries).flatMap((match) => {
    const texts = replacedTexts(words, match, match.replacement);
    return texts ? [{ ...match, texts }] : [];
  });
}
