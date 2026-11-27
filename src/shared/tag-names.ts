import { tagColors, type TagColor } from "./contracts/tags.ts";
import { foldSearchText } from "./search-text.ts";

const nameOrder = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export const tagNameKey = (name: string) => name.normalize("NFC").toLocaleLowerCase("und");

export const compareTagNames = (first: { name: string }, second: { name: string }) =>
  nameOrder.compare(first.name, second.name);

export const sortTags = <T extends { name: string }>(tags: readonly T[]) =>
  tags.toSorted(compareTagNames);

export function leastUsedColor(used: readonly TagColor[]): TagColor {
  const uses = (color: TagColor) => used.filter((each) => each === color).length;
  return tagColors.reduce((best, color) => (uses(color) < uses(best) ? color : best));
}

export function tagNameMatches(name: string, query: string) {
  const words = foldSearchText(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const nameWords = foldSearchText(name).split(/\s+/u);
  return words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)));
}
