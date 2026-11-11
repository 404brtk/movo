import type { ModelMessage } from "ai";
import { expect, it } from "vitest";
import { answerMoments } from "../../../../src/server/ask/ask.ts";

const first = "0a6c1f0e-4c1b-4b8a-9d3e-2f1a5b6c7d80";
const second = "1b7d2a1f-5d2c-4c9b-8e4f-3a2b6c7d8e91";

const question = (text: string) => ({
  role: "user" as const,
  state: "done" as const,
  passage: null,
  messages: [{ role: "user", content: text } satisfies ModelMessage],
});

const answer = (reads: { id: string; mediaId: string; starts: number[] }[], text: string) => ({
  role: "assistant" as const,
  state: "done" as const,
  passage: null,
  messages: [
    ...reads.flatMap(({ id, mediaId, starts }): ModelMessage[] => [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: id, toolName: "read_transcript", input: { mediaId } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: id,
            toolName: "read_transcript",
            output: {
              type: "json",
              value: { passages: starts.map((startMs) => ({ startMs, text: "Words" })) },
            },
          },
        ],
      },
    ]),
    { role: "assistant", content: text } satisfies ModelMessage,
  ],
});

it("links each answer to the recording its own turn read and leaves times read in several turns unlinked", () => {
  const answers = answerMoments(
    [
      question("Where?"),
      answer([{ id: "a", mediaId: first, starts: [0, 4000] }], "Here [0]."),
      question("And there?"),
      answer([{ id: "b", mediaId: second, starts: [0] }], "There [0], earlier [4000]."),
      question("Which start?"),
      answer([], "The start [0] or [4000]."),
    ],
    null,
  );
  expect(answers.map((entry) => entry.moments)).toEqual([
    [],
    [{ startMs: 0, mediaId: first }],
    [],
    [
      { startMs: 0, mediaId: second },
      { startMs: 4000, mediaId: first },
    ],
    [],
    [{ startMs: 4000, mediaId: first }],
  ]);
  expect(answers.flatMap((entry) => entry.recordings)).toEqual([first, second, first, first]);
});

it("leaves a moment unlinked when one turn read it in two recordings", () => {
  const reads = [
    { id: "a", mediaId: first, starts: [0, 4000] },
    { id: "b", mediaId: second, starts: [0] },
  ];
  const [, done] = answerMoments([question("Where?"), answer(reads, "At [0] and [4000].")], null);
  expect(done?.moments).toEqual([{ startMs: 4000, mediaId: first }]);
  const [, writing] = answerMoments(
    [question("Where?"), { ...answer(reads, ""), state: "answering" as const }],
    null,
  );
  expect(writing?.moments).toEqual([{ startMs: 4000, mediaId: first }]);
});
