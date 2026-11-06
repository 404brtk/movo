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

export function searchTerms(query: string) {
  return [...new Set(foldSearchText(query).match(searchToken))];
}

export function matchedRanges(text: string, terms: readonly string[]) {
  return Array.from(text.matchAll(displayedWord))
    .filter((word) => {
      const folded = foldSearchText(word[0]);
      return terms.some((term) => folded.startsWith(term));
    })
    .map((word) => ({ start: word.index, end: word.index + word[0].length }));
}
