import { describe, expect, it } from "vitest";
import {
  answerFromTranscriptParts,
  combineInstructions,
  groupBySize,
  partInstructions,
  scanTranscript,
  type ScanRequest,
} from "../../../../src/server/ask/scan.ts";

const lines = Array.from({ length: 12 }, (_, index) => `[${index * 1000}] ${"word ".repeat(18)}`);
const tooLong = new Error("prompt is too long");

function request(overrides: Partial<ScanRequest> = {}) {
  const calls: { instructions: string; prompt: string }[] = [];
  const progress: [number, number][] = [];
  const scan: ScanRequest = {
    title: "Budget",
    lines,
    instruction: "List the decisions",
    callCharacters: 1100,
    resultCharacters: 100_000,
    read: async (instructions, prompt) => {
      calls.push({ instructions, prompt });
      const starts = [...prompt.matchAll(/^\[(\d+)\]/gmu)].map((match) => match[1]);
      return instructions === partInstructions
        ? `Decided [${starts[0]}].`
        : `Combined ${prompt.match(/Part \d+/gu)?.join(", ") ?? "notes"}`;
    },
    tooLong: (error) => error === tooLong,
    onProgress: (read, total) => {
      progress.push([read, total]);
    },
    ...overrides,
  };
  return { scan, calls, progress };
}

describe("groupBySize", () => {
  it("fills each group up to the size and keeps an oversized item on its own", () => {
    expect(groupBySize(["aaaa", "bb", "cc", "dddddddddd", "e"], 8)).toEqual([
      ["aaaa", "bb"],
      ["cc"],
      ["dddddddddd"],
      ["e"],
    ]);
    expect(groupBySize([], 8)).toEqual([]);
  });
});

describe("scanTranscript", () => {
  it("reads every line once, in order, in parts sized to the call, and returns cited notes", async () => {
    const { scan, calls, progress } = request();
    const result = await scanTranscript(scan);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => call.instructions === partInstructions)).toBe(true);
    expect(calls.every((call) => call.prompt.length + partInstructions.length <= 1100)).toBe(true);
    const read = calls.flatMap((call) =>
      [...call.prompt.matchAll(/^\[\d+\][^\n]*/gmu)].map((match) => match[0]),
    );
    expect(read).toEqual(lines);
    expect(calls[0]?.prompt).toContain("Instruction: List the decisions");
    expect(calls[0]?.prompt).toContain('Part 1 of the transcript of "Budget"');
    expect(result.partCount).toBe(calls.length);
    expect(result.notes).toBe(
      calls
        .map((call, index) => {
          const start = /^\[(\d+)\]/mu.exec(call.prompt)?.[1];
          return `Part ${index + 1}:\nDecided [${start}].`;
        })
        .join("\n\n"),
    );
    expect(progress).toEqual(calls.map((_, index) => [index, calls.length]));
  });

  it("combines the notes until they fit the room left in the conversation", async () => {
    const { scan, calls, progress } = request({
      resultCharacters: 40,
      callCharacters: 1100,
    });
    const result = await scanTranscript(scan);
    const parts = calls.filter((call) => call.instructions === partInstructions);
    const combined = calls.filter((call) => call.instructions === combineInstructions);
    expect(combined.length).toBeGreaterThan(0);
    expect(combined[0]?.prompt).toContain("Notes:\nPart 1:");
    expect(result.partCount).toBe(parts.length);
    expect(result.notes.length).toBeLessThanOrEqual(40);
    expect(progress.at(-1)).toEqual([parts.length, parts.length]);
  });

  it("splits a part the model rejects as too long and reads both halves", async () => {
    let rejected = false;
    const { scan, calls } = request({
      callCharacters: 100_000,
      read: async (instructions, prompt) => {
        calls.push({ instructions, prompt });
        if (!rejected) {
          rejected = true;
          throw tooLong;
        }
        return "Noted [0].";
      },
    });
    const result = await scanTranscript(scan);
    expect(result.partCount).toBe(2);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.prompt).toContain("Part 1 of");
    expect(calls[2]?.prompt).toContain("Part 2 of");
    expect(result.notes).toBe("Part 1:\nNoted [0].\n\nPart 2:\nNoted [0].");
  });

  it("stops on any other failure and when even one line doesn't fit", async () => {
    const failure = new Error("The server isn't running");
    await expect(
      scanTranscript(
        request({
          read: async () => {
            throw failure;
          },
        }).scan,
      ),
    ).rejects.toBe(failure);
    await expect(scanTranscript(request({ callCharacters: 300 }).scan)).rejects.toThrow(
      "The model's context is too small to read this transcript in parts.",
    );
  });

  it("fails rather than looping when combining can't make the notes shorter", async () => {
    const { scan } = request({
      resultCharacters: 10,
      read: async () => "x".repeat(900),
    });
    await expect(scanTranscript(scan)).rejects.toThrow(
      "The notes from this transcript don't fit the model's context. Ask about a narrower topic.",
    );
  });

  it("fails before reading any part when there is no space for notes", async () => {
    const { scan, calls, progress } = request({ resultCharacters: 0 });
    await expect(scanTranscript(scan)).rejects.toThrow("Ask about a narrower topic.");
    expect(calls).toEqual([]);
    expect(progress).toEqual([]);
  });
});

describe("answerFromTranscriptParts", () => {
  it("reads the parts once and answers again from shorter notes after a too-long rejection", async () => {
    const { scan, calls } = request();
    const partReads = () => calls.filter((call) => call.instructions === partInstructions).length;
    const answered: { notes: string; partReads: number }[] = [];
    const answer = await answerFromTranscriptParts(scan, async (notes) => {
      answered.push({ notes, partReads: partReads() });
      if (answered.length === 1) throw tooLong;
      return "Summary";
    });
    expect(answer).toBe("Summary");
    expect(answered).toHaveLength(2);
    expect(answered[1]?.notes.length).toBeLessThanOrEqual((answered[0]?.notes.length ?? 0) / 2);
    expect(answered[1]?.partReads).toBe(answered[0]?.partReads);
    expect(calls.at(-1)?.instructions).toBe(combineInstructions);
  });

  it("stops when the notes can't get any shorter instead of retrying forever", async () => {
    const { scan } = request();
    await expect(
      answerFromTranscriptParts(scan, async () => {
        throw tooLong;
      }),
    ).rejects.toThrow("The notes from this transcript don't fit the model's context.");
  });

  it("passes on any other failure of the answer", async () => {
    const failure = new Error("The server isn't running");
    await expect(
      answerFromTranscriptParts(request().scan, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
