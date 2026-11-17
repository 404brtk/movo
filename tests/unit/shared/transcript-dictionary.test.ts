import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { DictionaryDraft } from "../../../src/shared/contracts/dictionary.ts";
import { Transcript, type TranscriptWord } from "../../../src/shared/contracts/transcriptions.ts";
import {
  allowedDistance,
  allowsSimilar,
  dictionaryFixes,
  dictionaryKeys,
} from "../../../src/shared/transcript-dictionary.ts";
import { applyPatch, replaceRanges } from "../../../src/shared/transcript-edits.ts";
import { timedWords } from "../../helpers/timed-words.ts";

const entry = (spelling: string, options: Partial<DictionaryDraft> = {}): DictionaryDraft => ({
  spelling,
  similar: allowsSimilar(spelling),
  alsoReplace: [],
  neverChange: [],
  ...options,
});

const fixed = (text: string, entries: readonly DictionaryDraft[]) => {
  const words = timedWords(0, 10_000, text);
  const changed = applyPatch(words, replaceRanges(words, dictionaryFixes(words, entries)));
  Schema.decodeUnknownSync(Transcript)({ language: null, words: changed });
  return changed.map((word: TranscriptWord) => word.text).join(" ");
};

describe("dictionary matching", () => {
  it("fixes the spelling's case and keeps the punctuation around it", () => {
    expect(fixed("I opened movo, then MOVO again.", [entry("Movo")])).toBe(
      "I opened Movo, then Movo again.",
    );
  });

  it("leaves short words exact so they cannot change ordinary words", () => {
    expect(allowsSimilar("Movo")).toBe(false);
    expect(fixed("nowo mowa mowo", [entry("Movo", { similar: true })])).toBe("nowo mowa mowo");
  });

  it("scales the allowed difference with the spelling's length", () => {
    expect(allowedDistance("Movo")).toBe(0);
    expect(allowedDistance("Ollama")).toBe(1);
    expect(allowedDistance("Kubernetes")).toBe(2);
    expect(allowedDistance("Żółwik")).toBe(1);
    expect(fixed("olama and olamma", [entry("Ollama")])).toBe("Ollama and olamma");
    expect(fixed("kubernetis and kuberntis", [entry("Kubernetes")])).toBe(
      "Kubernetes and Kubernetes",
    );
  });

  it("finds similar spellings without case, accents or a missed space", () => {
    expect(fixed("we chose para keet and Parakit, not parakat.", [entry("Parakeet")])).toBe(
      "we chose Parakeet and Parakeet, not Parakeet.",
    );
  });

  it("does not join words across punctuation", () => {
    expect(fixed("para, keet", [entry("Parakeet")])).toBe("para, keet");
  });

  it("replaces listed phrases that sound different", () => {
    expect(
      fixed("ask cloud code. Cloud Code helps", [
        entry("Claude Code", { alsoReplace: ["cloud code"] }),
      ]),
    ).toBe("ask Claude Code. Claude Code helps");
  });

  it("never changes listed exceptions", () => {
    expect(
      fixed("Parakit sang with two parakeets.", [
        entry("Parakeet", { neverChange: ["parakeets"] }),
      ]),
    ).toBe("Parakeet sang with two parakeets.");
  });

  it("never changes any word inside a listed exception phrase", () => {
    const parakeet = entry("Parakeet", { neverChange: ["parakit bird"] });
    expect(fixed("a parakit bird and a parakit", [parakeet])).toBe("a parakit bird and a Parakeet");
    expect(
      fixed("open cloud code tools", [
        entry("Claude Code", { alsoReplace: ["cloud code"], neverChange: ["code tools"] }),
      ]),
    ).toBe("open cloud code tools");
  });

  it("never turns one entry's spelling into another entry", () => {
    expect(fixed("Sortformer and Sortformers", [entry("Sortformers"), entry("Sortformer")])).toBe(
      "Sortformer and Sortformers",
    );
  });

  it("prefers exact matches, then longer phrases, then closer spellings", () => {
    expect(
      fixed("claude code and Kodex", [entry("Claude Code"), entry("Claude"), entry("Codex")]),
    ).toBe("Claude Code and Codex");
    expect(fixed("Parakeat", [entry("Parakeet"), entry("Parakeets")])).toBe("Parakeet");
  });

  it("applies each fix once, so one fix cannot trigger another", () => {
    expect(
      fixed("alpha", [entry("Alphabet", { alsoReplace: ["alpha"] }), entry("Alphabets")]),
    ).toBe("Alphabet");
  });

  it("reports only words that change", () => {
    const words = timedWords(0, 1000, "Movo is ready");
    expect(dictionaryFixes(words, [entry("Movo")])).toEqual([]);
  });

  it("leaves spellings with their own punctuation alone once they are right", () => {
    const words = timedWords(0, 3000, "we ship .NET and (.NET), ask the C.P.A.");
    expect(dictionaryFixes(words, [entry(".NET"), entry("C.P.A.")])).toEqual([]);
    expect(
      fixed("we ship net, ask the cpa", [entry(".NET"), entry("C.P.A.", { alsoReplace: ["cpa"] })]),
    ).toBe("we ship .NET, ask the C.P.A.");
  });

  it("keeps the timestamps of replaced words", () => {
    const words = timedWords(0, 4000, "the para keet model");
    const [fix] = dictionaryFixes(words, [entry("Parakeet")]);
    expect(fix).toMatchObject({ firstWord: 1, wordCount: 2, similar: true, texts: ["Parakeet"] });
    const changed = applyPatch(words, replaceRanges(words, fix ? [fix] : []));
    expect(changed[1]).toEqual({ startMs: 1000, endMs: 3000, text: "Parakeet" });
  });

  it("compares keys of spellings and variants without case or spacing", () => {
    expect(dictionaryKeys({ spelling: "Claude  Code", alsoReplace: ["CLOUD code"] })).toEqual([
      "claude code",
      "cloud code",
    ]);
  });
});
