import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  calibratedCharactersPerToken,
  maxChatPagePassages,
  minPagePassages,
  trimStepMessages,
  type StoredMessage,
} from "../../../../src/server/ask/prompt.ts";

const toolTurn = (seq: number, result: string): StoredMessage[] => [
  { seq, role: "user", messages: [{ role: "user", content: `Question ${seq}` }] },
  {
    seq: seq + 1,
    role: "assistant",
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: `c${seq}`, toolName: "read_transcript", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: `c${seq}`,
            toolName: "read_transcript",
            output: { type: "text", value: result },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: `Answer ${seq}` }] },
    ],
  },
];

const turns = (count: number, resultSize: number) =>
  Array.from({ length: count }, (_, index) =>
    toolTurn(index * 2 + 1, "x".repeat(resultSize)),
  ).flat();

const results = (messages: readonly ModelMessage[]) =>
  messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) =>
          part.type === "tool-result" && part.output.type === "text" ? [part.output.value] : [],
        )
      : [],
  );

const base = {
  prefixCharacters: 1000,
  charactersPerToken: 4,
  cuts: { toolCutSeq: 0, contextCutSeq: 0 },
};

describe("buildPrompt", () => {
  it("sends the whole history unchanged while it fits", () => {
    const rows = turns(3, 100);
    const prompt = buildPrompt({ ...base, rows, contextTokens: 100_000 });
    expect(prompt.cuts).toEqual(base.cuts);
    expect(prompt.messages).toEqual(rows.flatMap((row) => row.messages));
    expect(prompt.pagePassages).toBe(maxChatPagePassages);
  });

  it("replaces older tool results with stubs before dropping any turn", () => {
    const rows = turns(6, 4000);
    const prompt = buildPrompt({ ...base, rows, contextTokens: 6000 });
    expect(prompt.cuts).toEqual({ toolCutSeq: 9, contextCutSeq: 0 });
    const read = results(prompt.messages);
    expect(read).toHaveLength(6);
    expect(read.slice(0, 4).every((value) => value.includes("removed to save room"))).toBe(true);
    expect(read.slice(4).every((value) => value === "x".repeat(4000))).toBe(true);
    expect(JSON.stringify(prompt.messages)).toContain("Answer 1");
  });

  it("drops whole old turns in batches when stubs are not enough, keeping the latest turn", () => {
    const rows = Array.from({ length: 12 }, (_, index) => [
      {
        seq: index * 2 + 1,
        role: "user" as const,
        messages: [{ role: "user" as const, content: "q".repeat(2000) }],
      },
      {
        seq: index * 2 + 2,
        role: "assistant" as const,
        messages: [{ role: "assistant" as const, content: "a".repeat(2000) }],
      },
    ]).flat();
    const prompt = buildPrompt({ ...base, rows, contextTokens: 8000 });
    expect(prompt.cuts.contextCutSeq).toBe(17);
    expect(prompt.messages).toHaveLength(8);
    expect(prompt.messages[0]).toEqual(rows.find((row) => row.seq === 17)?.messages[0]);
    const tiny = buildPrompt({ ...base, rows, contextTokens: 100 });
    expect(tiny.cuts.contextCutSeq).toBe(23);
    expect(tiny.messages).toHaveLength(2);
    expect(tiny.pagePassages).toBe(minPagePassages);
  });

  it("never moves a stored cut back, so the cached prefix stays the same", () => {
    const rows = turns(4, 10);
    const prompt = buildPrompt({
      ...base,
      rows,
      cuts: { toolCutSeq: 5, contextCutSeq: 3 },
      contextTokens: 100_000,
    });
    expect(prompt.cuts).toEqual({ toolCutSeq: 5, contextCutSeq: 3 });
    expect(prompt.messages[0]).toEqual({ role: "user", content: "Question 3" });
    expect(results(prompt.messages)[0]).toContain("removed to save room");
    expect(buildPrompt({ ...base, rows, cuts: prompt.cuts, contextTokens: 100_000 })).toEqual(
      prompt,
    );
  });

  it("shrinks transcript pages as the free context gets smaller", () => {
    const rows = turns(1, 10);
    const roomy = buildPrompt({ ...base, rows, contextTokens: 200_000 }).pagePassages;
    const small = buildPrompt({ ...base, rows, contextTokens: 4096 }).pagePassages;
    expect(roomy).toBe(maxChatPagePassages);
    expect(small).toBeLessThan(roomy);
    expect(small).toBeGreaterThanOrEqual(minPagePassages);
  });
});

describe("trimStepMessages", () => {
  it("stubs earlier tool results of the current answer but keeps the latest one", () => {
    const history: ModelMessage[] = [{ role: "user", content: "Question" }];
    const steps = toolTurn(1, "y".repeat(5000))[1]?.messages.slice(0, 2) ?? [];
    const messages = [...history, ...steps, ...steps];
    const trimmed = trimStepMessages(messages, history.length, 6000);
    expect(results(trimmed)[0]).toContain("removed to save room");
    expect(results(trimmed)[1]).toBe("y".repeat(5000));
    expect(trimStepMessages(messages, history.length, 1_000_000)).toEqual(messages);
  });
});

it("calibrates characters per token from the provider's measured input", () => {
  expect(calibratedCharactersPerToken(undefined)).toBe(3.5);
  expect(calibratedCharactersPerToken({ inputTokens: 1000, promptCharacters: 4200 })).toBe(4.2);
  expect(calibratedCharactersPerToken({ inputTokens: 1000, promptCharacters: 100 })).toBe(2);
});
