import { describe, expect, it } from "vitest";
import {
  containsEveryTerm,
  foldSearchText,
  matchedRanges,
  searchTerms,
} from "../../../src/shared/search-text.ts";

describe("search text", () => {
  it("folds case, Latin diacritics and letters without a decomposition", () => {
    expect(foldSearchText("Źródło ŁÓDŹ Øresund Đak Ħal ŧ ı Crème")).toBe(
      "zrodlo lodz oresund dak hal t i creme",
    );
  });

  it("keeps letters of other scripts intact", () => {
    expect(foldSearchText("Йогурт Ελλάδα")).toBe("йогурт ελλάδα");
  });

  it("turns a query into unique word terms without search syntax", () => {
    expect(searchTerms('  "Łódź" OR title:Budżet* -(łódź) NEAR ')).toEqual([
      "lodz",
      "or",
      "title",
      "budzet",
      "near",
    ]);
    expect(searchTerms(" ?! … ")).toEqual([]);
  });

  it("marks whole words that start with a term in the original text", () => {
    const text = "Zażółć gęślą jaźń, it's Łódź.";
    const ranges = matchedRanges(text, searchTerms("zazo lodz s"));
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual([
      "Zażółć",
      "s",
      "Łódź",
    ]);
    expect(matchedRanges(text, ["absent"])).toEqual([]);
  });

  it("requires every term to start a word in one of the texts", () => {
    const terms = searchTerms("lucja budz");
    expect(containsEveryTerm(["Budżet jest gotowy.", "Łucja Nowak"], terms)).toBe(true);
    expect(containsEveryTerm(["Budżet jest gotowy."], terms)).toBe(false);
    expect(containsEveryTerm(["Zbudżetowany plan."], ["budz"])).toBe(false);
    expect(containsEveryTerm(["Cokolwiek"], [])).toBe(true);
  });

  it("splits words with non-Latin combining marks like the query and the search index", () => {
    const text = "मुझे हिंदी पसंद है";
    const terms = searchTerms("हिंदी");
    expect(terms).toEqual(["ह", "द"]);
    expect(containsEveryTerm([text], terms)).toBe(true);
    expect(containsEveryTerm(["Budget", "हिंदी"], terms)).toBe(true);
    expect(containsEveryTerm(["मुझे"], terms)).toBe(false);
    expect(matchedRanges(text, ["द"]).map((range) => text.slice(range.start, range.end))).toEqual([
      "हिंदी",
      "पसंद",
    ]);
  });
});
