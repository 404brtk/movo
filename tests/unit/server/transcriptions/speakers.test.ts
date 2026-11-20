import { describe, expect, it } from "vitest";
import { maxSpeakers, type Transcript } from "../../../../src/shared/contracts/transcriptions.ts";
import { assignSpeakers } from "../../../../src/server/transcriptions/speakers.ts";

const transcript = (...spans: [number, number][]): Transcript => ({
  language: "pl",
  words: spans.map(([startMs, endMs], index) => ({ startMs, endMs, text: `w${index}` })),
});
const turn = (speaker: number, startMs: number, endMs: number) => ({
  start: startMs / 1000,
  end: endMs / 1000,
  speaker,
});
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

  it("numbers speakers from one when the engine counts them from zero", () => {
    const result = assignSpeakers(transcript([0, 100], [200, 300]), [
      turn(0, 0, 150),
      turn(1, 150, 300),
    ]);
    expect(speakers(result)).toEqual([1, 2]);
  });

  it("rejects more speakers than a transcript can label", () => {
    const spans = Array.from({ length: maxSpeakers + 1 }, (_, index): [number, number] => [
      index * 1000,
      index * 1000 + 500,
    ]);
    expect(() =>
      assignSpeakers(
        transcript(...spans),
        spans.map(([startMs, endMs], index) => turn(index, startMs, endMs)),
      ),
    ).toThrow(`more than ${maxSpeakers} speakers`);
  });

  it("keeps a transcript without speakers when no turns were found", () => {
    const original = transcript([0, 100]);
    expect(assignSpeakers(original, [])).toBe(original);
  });

  it.each([
    { name: "a reversed turn", turns: [turn(1, 500, 100)], cause: /ends before it starts/u },
    {
      name: "a negative speaker",
      turns: [turn(-1, 0, 100)],
      cause: /greater than or equal to 0/u,
    },
    {
      name: "an unreadable value",
      turns: [{ speaker: 1, start: "0", end: 0.1 }],
      cause: /Expected number/u,
    },
  ])("rejects $name from the engine", ({ turns, cause }) => {
    expect(() => assignSpeakers(transcript([0, 100]), turns)).toThrow(cause);
  });
});
