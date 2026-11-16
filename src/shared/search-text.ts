const latinDiacritics = /(\p{Script=Latin})\p{M}+/gu;
const plainLetters: Readonly<Record<string, string>> = {
  ł: "l",
  đ: "d",
  ø: "o",
  ħ: "h",
  ŧ: "t",
  ı: "i",
};
const lettersWithoutDecomposition = new RegExp(`[${Object.keys(plainLetters).join("")}]`, "gu");
const searchToken = /[\p{L}\p{N}\p{Co}]+/gu;
const displayedWord = /[\p{L}\p{N}\p{Co}\p{M}]+/gu;

export function foldSearchText(text: string) {
  return text
    .normalize("NFD")
    .replace(latinDiacritics, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(lettersWithoutDecomposition, (letter) => plainLetters[letter] ?? letter);
}

const searchTokens = (text: string) => foldSearchText(text).match(searchToken) ?? [];

const startsWithTerm = (tokens: readonly string[], term: string) =>
  tokens.some((token) => token.startsWith(term));

export function searchTerms(query: string) {
  return [...new Set(searchTokens(query))];
}

export function matchedRanges(text: string, terms: readonly string[]) {
  return Array.from(text.matchAll(displayedWord))
    .filter((word) => {
      const tokens = searchTokens(word[0]);
      return terms.some((term) => startsWithTerm(tokens, term));
    })
    .map((word) => ({ start: word.index, end: word.index + word[0].length }));
}

export function containsEveryTerm(texts: readonly string[], terms: readonly string[]) {
  const tokens = texts.flatMap(searchTokens);
  return terms.every((term) => startsWithTerm(tokens, term));
}
