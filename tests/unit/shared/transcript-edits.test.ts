import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PassageEdit,
  Transcript,
  type TranscriptPatch,
  type TranscriptWord,
} from "../../../src/shared/contracts/transcriptions.ts";
import {
  applyPatch,
  diffWords,
  editWords,
  findWords,
  invertPatch,
  replaceWords,
} from "../../../src/shared/transcript-edits.ts";
import { timedWords } from "../../helpers/timed-words.ts";

const texts = (words: readonly TranscriptWord[]) => words.map((word) => word.text).join(" ");

const checkedRoundTrip = (words: readonly TranscriptWord[], patch: TranscriptPatch) => {
  const changed = applyPatch(words, patch);
  Schema.decodeUnknownSync(Transcript)({ language: null, words: changed });
  expect(applyPatch(changed, invertPatch(patch))).toEqual(words);
  return changed;
};

describe("passage edits", () => {
  const words = timedWords(1000, 2000, "We deploy to kuber netes daily.");

  it("keeps every timestamp when the number of words stays the same", () => {
    const patch = editWords(words, 0, 6, "We deploy to Kuber Netes daily.");
    expect(patch).toEqual([
      {
        firstWord: 3,
        removed: words.slice(3, 5),
        inserted: [
          { ...words[3], text: "Kuber" },
          { ...words[4], text: "Netes" },
        ],
      },
    ]);
  });

  it("retimes only the changed words within their original span", () => {
    const changed = checkedRoundTrip(
      words,
      editWords(words, 0, 6, "We deploy to Kubernetes daily."),
    );
    expect(texts(changed)).toBe("We deploy to Kubernetes daily.");
    expect(changed.slice(0, 3)).toEqual(words.slice(0, 3));
    expect(changed[3]).toEqual({
      startMs: words[3]?.startMs,
      endMs: words[4]?.endMs,
      text: "Kubernetes",
    });
    expect(changed[4]).toEqual(words[5]);
  });

  it("splits a word's span by character length", () => {
    const changed = checkedRoundTrip(
      words,
      editWords(words, 0, 6, "We deploy to Kubernetes clusters daily."),
    );
    const [kubernetes, clusters] = [changed[3], changed[4]];
    expect(kubernetes?.startMs).toBe(words[3]?.startMs);
    expect(clusters?.endMs).toBe(words[4]?.endMs);
    expect(kubernetes?.endMs).toBe(clusters?.startMs);
    expect(clusters?.startMs).toBeGreaterThan(kubernetes?.startMs ?? 0);
  });

  it("removes words when their text is deleted", () => {
    const changed = checkedRoundTrip(words, editWords(words, 0, 6, "We deploy daily."));
    expect(texts(changed)).toBe("We deploy daily.");
  });

  it("removes a whole passage", () => {
    expect(checkedRoundTrip(words, editWords(words, 0, 6, "   "))).toEqual([]);
  });

  it("inserts words between neighbours without moving them", () => {
    const changed = checkedRoundTrip(
      words,
      editWords(words, 0, 6, "We often deploy to kuber netes daily."),
    );
    expect(changed[1]).toEqual({
      startMs: words[0]?.endMs,
      endMs: words[1]?.startMs,
      text: "often",
    });
  });

  it("returns no change for identical text", () => {
    expect(editWords(words, 0, 6, " We  deploy to\nkuber netes daily. ")).toEqual([]);
  });

  it("keeps words ordered when a removed word overlaps the next one", () => {
    const overlapping: TranscriptWord[] = [
      { startMs: 0, endMs: 900, text: "one" },
      { startMs: 100, endMs: 200, text: "two" },
    ];
    const changed = checkedRoundTrip(overlapping, editWords(overlapping, 0, 1, "a b c"));
    expect(changed.map((word) => word.startMs)).toEqual([0, 100, 100, 100]);
  });

  it("rejects words longer than a transcript allows", () => {
    const decode = Schema.decodeUnknownSync(PassageEdit);
    expect(() =>
      decode({ revision: 0, firstWord: 0, wordCount: 1, text: `ok ${"x".repeat(1025)}` }),
    ).toThrow(/1024 characters/u);
    expect(
      decode({ revision: 0, firstWord: 0, wordCount: 1, text: "x".repeat(1024) }).text,
    ).toHaveLength(1024);
  });
});

describe("find and replace", () => {
  const words = timedWords(0, 6000, "“Kubernetis, I said, uses kuber netes. KUBERNETIS!”");

  it("matches whole words regardless of case and keeps surrounding punctuation", () => {
    const changed = checkedRoundTrip(words, replaceWords(words, "kubernetis", "Kubernetes"));
    expect(texts(changed)).toBe("“Kubernetes, I said, uses kuber netes. Kubernetes!”");
  });

  it("matches phrases spanning several words", () => {
    const patch = replaceWords(words, "Kuber Netes", "Kubernetes");
    expect(patch).toHaveLength(1);
    expect(texts(checkedRoundTrip(words, patch))).toContain("uses Kubernetes. KUBERNETIS!”");
  });

  it("does not match parts of words or ignore diacritics", () => {
    expect(replaceWords(words, "kube", "x")).toEqual([]);
    const polish = timedWords(0, 1000, "żółw zolw");
    expect(texts(applyPatch(polish, replaceWords(polish, "zolw", "kot")))).toBe("żółw kot");
  });

  it("skips matches that already read like the replacement while still finding them", () => {
    const patch = replaceWords(words, "kubernetis", "KUBERNETIS");
    expect(patch).toHaveLength(1);
    expect(patch[0]?.firstWord).toBe(0);
    expect(findWords(words, "KUBERNETIS")).toEqual([
      { firstWord: 0, wordCount: 1 },
      { firstWord: 6, wordCount: 1 },
    ]);
  });

  it("deletes matches when the replacement is empty", () => {
    const filler = timedWords(0, 3000, "so um we um ship");
    expect(texts(checkedRoundTrip(filler, replaceWords(filler, "um", "")))).toBe("so we ship");
  });

  it("does not rescan inserted text", () => {
    const patch = replaceWords(timedWords(0, 1000, "go go"), "go", "go go");
    expect(patch).toHaveLength(2);
  });
});

describe("patches", () => {
  const words = timedWords(0, 4000, "one two three four");

  it("rejects a patch made for a different transcript", () => {
    const patch = editWords(words, 1, 1, "TWO");
    expect(() => applyPatch(applyPatch(words, patch), patch)).toThrow(/does not match/u);
    expect(() => applyPatch(words.slice(0, 1), patch)).toThrow(/does not match/u);
  });

  it("undoes several changes with shifting positions", () => {
    const patch = [...editWords(words, 0, 1, "zero one"), ...editWords(words, 2, 2, "")];
    expect(texts(checkedRoundTrip(words, patch))).toBe("zero one two");
  });
});

describe("net differences", () => {
  const words = [
    ...timedWords(0, 1000, "We deploy kubernetis daily."),
    ...timedWords(1000, 2000, "It keeps running."),
    ...timedWords(2000, 3000, "Kubernetis scales well."),
  ];

  it("finds no difference between equal transcripts", () => {
    expect(diffWords(words, [...words])).toEqual([]);
  });

  it("finds only the changed words", () => {
    const changed = applyPatch(words, replaceWords(words, "kubernetis", "Kubernetes"));
    expect(diffWords(words, changed)).toEqual(replaceWords(words, "kubernetis", "Kubernetes"));
  });

  it("turns any version into any other", () => {
    const versions = [
      words,
      applyPatch(words, editWords(words, 0, 4, "We now deploy Kubernetes clusters daily.")),
      applyPatch(words, editWords(words, 4, 3, "")),
      applyPatch(words, editWords(words, 7, 3, "It scales well, really well.")),
      [],
    ];
    for (const before of versions)
      for (const after of versions)
        expect(checkedRoundTrip(before, diffWords(before, after))).toEqual(after);
  });

  it("stays as small as the edit when restoring back and forth", () => {
    const edited = applyPatch(words, editWords(words, 4, 3, "It keeps working."));
    expect(diffWords(edited, words)).toEqual([
      { firstWord: 6, removed: [edited[6]], inserted: [words[6]] },
    ]);
  });
});
