import type { TranscriptWord } from "./contracts/transcriptions.ts";

export const maxPassageCharacters = 84;
export const maxPassageMs = 7000;
export const passageBreakSilenceMs = 3000;
const closingMarks = String.raw`["'”’)\]]*$`;
const sentenceEnding = new RegExp(`[.!?…]${closingMarks}`, "u");
const clauseEnding = new RegExp(`[,;:]${closingMarks}`, "u");
const openingMarks = /^["'“‘([]+/u;
const abbreviations = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "rev.",
  "hon.",
  "gen.",
  "gov.",
  "sen.",
  "rep.",
  "capt.",
  "lt.",
  "col.",
  "sgt.",
  "st.",
  "mt.",
  "vs.",
  "etc.",
  "e.g.",
  "i.e.",
  "cf.",
  "approx.",
  "fig.",
]);

export interface TranscriptPassage {
  startMs: number;
  endMs: number;
  text: string;
  firstWord: number;
  words: readonly TranscriptWord[];
}

function passage(words: readonly TranscriptWord[], firstWord: number): TranscriptPassage {
  const [first] = words;
  if (!first) throw new Error("A passage needs at least one word.");
  return {
    startMs: first.startMs,
    endMs: Math.max(...words.map((word) => word.endMs)),
    text: words.map((word) => word.text).join(" "),
    firstWord,
    words,
  };
}

function endsSentence(text: string) {
  return (
    sentenceEnding.test(text) && !abbreviations.has(text.replace(openingMarks, "").toLowerCase())
  );
}

function fits({ text, startMs, endMs }: TranscriptPassage) {
  return text.length <= maxPassageCharacters && endMs - startMs <= maxPassageMs;
}

function middleCut({ words, text }: TranscriptPassage) {
  let leftLength = -1;
  const cuts = words.slice(0, -1).map((word, index) => {
    leftLength += word.text.length + 1;
    return {
      index: index + 1,
      imbalance: Math.abs(2 * leftLength - text.length),
      clause:
        clauseEnding.test(word.text) &&
        4 * leftLength >= text.length &&
        4 * leftLength <= 3 * text.length,
    };
  });
  const clauseCuts = cuts.filter((cut) => cut.clause);
  return (clauseCuts.length > 0 ? clauseCuts : cuts).reduce((best, cut) =>
    cut.imbalance < best.imbalance ? cut : best,
  ).index;
}

function fittingPassages(words: readonly TranscriptWord[], firstWord: number): TranscriptPassage[] {
  const whole = passage(words, firstWord);
  if (words.length === 1 || fits(whole)) return [whole];
  const cut = middleCut(whole);
  return [
    ...fittingPassages(words.slice(0, cut), firstWord),
    ...fittingPassages(words.slice(cut), firstWord + cut),
  ];
}

export function transcriptPassages(words: readonly TranscriptWord[]) {
  const passages: TranscriptPassage[] = [];
  let firstWord = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && !endsSentence(word.text) && next.startMs - word.endMs < passageBreakSilenceMs)
      return;
    passages.push(...fittingPassages(words.slice(firstWord, index + 1), firstWord));
    firstWord = index + 1;
  });
  return passages;
}

export function currentWordIndex(words: readonly TranscriptWord[], positionMs: number) {
  let started = 0;
  let notStarted = words.length;
  while (started < notStarted) {
    const middle = Math.floor((started + notStarted) / 2);
    const word = words[middle];
    if (word && word.startMs <= positionMs) started = middle + 1;
    else notStarted = middle;
  }
  return started - 1;
}
