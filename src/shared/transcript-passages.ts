import type { TranscriptWord } from "./contracts/transcriptions.ts";

export const maxPassageCharacters = 84;
export const maxPassageMs = 7000;
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

function fits(words: readonly TranscriptWord[]) {
  const { text, startMs, endMs } = passage(words, 0);
  return text.length <= maxPassageCharacters && endMs - startMs <= maxPassageMs;
}

function cutIndex(words: readonly TranscriptWord[], firstWord: number, overflowingWord: number) {
  const clauseEnd =
    firstWord +
    1 +
    words.slice(firstWord, overflowingWord).findLastIndex((word) => clauseEnding.test(word.text));
  return 2 * (clauseEnd - firstWord) >= overflowingWord - firstWord ? clauseEnd : overflowingWord;
}

export function transcriptPassages(words: readonly TranscriptWord[]) {
  const passages: TranscriptPassage[] = [];
  let firstWord = 0;
  const addPassageBefore = (end: number) => {
    passages.push(passage(words.slice(firstWord, end), firstWord));
    return end;
  };
  words.forEach((word, index) => {
    while (index > firstWord && !fits(words.slice(firstWord, index + 1)))
      firstWord = addPassageBefore(cutIndex(words, firstWord, index));
    if (endsSentence(word.text)) firstWord = addPassageBefore(index + 1);
  });
  if (firstWord < words.length) addPassageBefore(words.length);
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
