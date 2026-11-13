import { describe, expect, it } from "vitest";
import type { Transcript } from "../../../../src/shared/contracts/transcriptions.ts";
import { assignSpeakers } from "../../../../src/server/transcriptions/speakers.ts";

const transcript = (...spans: [number, number][]): Transcript => ({
  language: "pl",
  words: spans.map(([startMs, endMs], index) => ({ startMs, endMs, text: `w${index}` })),
});
const turn = (speakerId: number, t0Ms: number, t1Ms: number) => ({ speakerId, t0Ms, t1Ms, p: 0.9 });
const speakers = (result: Transcript) => result.words.map((word) => word.speaker);

describe("speaker assignment", () => {
  it("gives each word the speaker it overlaps most and numbers speakers by first appearance", () => {
    const result = assignSpeakers(transcript([0, 400], [400, 900], [1000, 1400], [1500, 1900]), [
      turn(3, 0, 950),
      turn(2, 700, 2000),
    ]);
    expect(speakers(result)).toEqual([1, 1, 2, 2]);
    expect(result.words.map((word) => word.text)).toEqual(["w0", "w1", "w2", "w3"]);
  });

  it("uses the nearest turn for words in a gap and for words without duration", () => {
    const result = assignSpeakers(transcript([0, 300], [1000, 1100], [1600, 1600], [5000, 5200]), [
      turn(1, 0, 900),
      turn(2, 1500, 1800),
      turn(1, 4000, 4500),
    ]);
    expect(speakers(result)).toEqual([1, 1, 2, 1]);
  });

  it("reads turns grouped by speaker in any order, as the engine reports them", () => {
    const result = assignSpeakers(transcript([0, 100], [600, 700], [1200, 1300], [1800, 1900]), [
      turn(2, 1500, 2000),
      turn(2, 500, 1000),
      turn(1, 1000, 1500),
      turn(1, 0, 500),
    ]);
    expect(speakers(result)).toEqual([1, 2, 1, 2]);
  });

  it("keeps a transcript without speakers when no turns were found", () => {
    const original = transcript([0, 100]);
    expect(assignSpeakers(original, [])).toBe(original);
  });

  it.each([
    { name: "a reversed turn", turns: [turn(1, 500, 100)], cause: /ends before it starts/u },
    {
      name: "a speaker without an id",
      turns: [turn(0, 0, 100)],
      cause: /greater than or equal to 1/u,
    },
    {
      name: "an unreadable value",
      turns: [{ speakerId: 1, t0Ms: "0", t1Ms: 100 }],
      cause: /Expected number/u,
    },
  ])("rejects $name from the engine", ({ turns, cause }) => {
    expect(() => assignSpeakers(transcript([0, 100]), turns)).toThrow(cause);
  });
});
