import { describe, expect, it } from "vitest";
import type { Transcript } from "../../../../src/shared/contracts/transcriptions.ts";
import { searchTerms } from "../../../../src/shared/search-text.ts";
import { transcriptPassages } from "../../../../src/shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../../../src/shared/transcript-speakers.ts";
import { searchPassages } from "../../../../src/web/lib/transcript-search.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const spokenBy = (speaker: number, words: Transcript["words"]) =>
  words.map((word) => ({ ...word, speaker }));

describe("transcript search", () => {
  const transcript: Transcript = {
    language: "pl",
    words: [
      ...spokenBy(1, timedWords(0, 900, "Budżet na przyszły rok.")),
      ...spokenBy(1, timedWords(1000, 1900, "Większość to licencje.")),
      ...spokenBy(2, timedWords(2000, 2900, "Anna ma rację co do budżetu.")),
      ...spokenBy(3, timedWords(3000, 3900, "Budżet zatwierdzony.")),
    ],
    speakers: [{ id: 1, name: "Anna Kowalska" }],
  };
  const passages = transcriptPassages(transcript.words);
  const search = (query: string) =>
    searchPassages(passages, transcriptSpeakers(transcript), searchTerms(query));

  it("finds passages with every word in what was said or in the speaker's name", () => {
    const hits = search("anna budż");
    expect([...hits.keys()]).toEqual([0, 7]);
    expect(hits.get(0)).toEqual({
      marks: [{ start: 0, end: 1, current: false }],
      speaker: { name: "Anna Kowalska", ranges: [{ start: 0, end: 4 }] },
    });
    expect(hits.get(7)).toEqual({
      marks: [
        { start: 0, end: 1, current: false },
        { start: 5, end: 6, current: false },
      ],
      speaker: undefined,
    });
  });

  const scoped = (query: string, chosen: readonly number[]) =>
    searchPassages(passages, transcriptSpeakers(transcript), searchTerms(query), chosen);

  it("searches only the passages of the chosen speakers", () => {
    expect([...scoped("budż", [2, 3]).keys()]).toEqual([7, 13]);
    expect([...scoped("licencje", [3]).keys()]).toEqual([]);
    expect(scoped("", [1]).size).toBe(0);
  });

  it("finds every passage of a named speaker and nothing for unnamed ones", () => {
    expect([...search("kowalska").keys()]).toEqual([0, 4]);
    expect(search("kowalska").get(4)?.marks).toEqual([]);
    expect(search("speaker").size).toBe(0);
    expect(search(" ?! ").size).toBe(0);
  });
});
