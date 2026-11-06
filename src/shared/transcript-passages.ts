import type { TranscriptWord } from "./contracts/transcriptions.ts";

export const maxPassageCharacters = 84;
export const maxPassageMs = 7000;
const sentenceEnding = /[.!?…]["'”’)\]]*$/u;

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

export function transcriptPassages(words: readonly TranscriptWord[]) {
  const passages: TranscriptPassage[] = [];
  let firstWord = 0;
  let characters = 0;
  words.forEach((word, index) => {
    const start = words[firstWord];
    if (
      start &&
      index > firstWord &&
      (characters + 1 + word.text.length > maxPassageCharacters ||
        word.endMs - start.startMs > maxPassageMs)
    ) {
      passages.push(passage(words.slice(firstWord, index), firstWord));
      firstWord = index;
      characters = 0;
    }
    characters += (index > firstWord ? 1 : 0) + word.text.length;
    if (sentenceEnding.test(word.text)) {
      passages.push(passage(words.slice(firstWord, index + 1), firstWord));
      firstWord = index + 1;
      characters = 0;
    }
  });
  if (firstWord < words.length) passages.push(passage(words.slice(firstWord), firstWord));
  return passages;
}
