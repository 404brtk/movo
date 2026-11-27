import { expect, it } from "vitest";
import {
  overviewContext,
  transcriptContext,
} from "../../../../src/server/ask/transcript-context.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

it("lists every passage after the startMs a citation names, with each change of speaker", () => {
  const words = [
    ...timedWords(0, 900, "The budget meeting starts.").map((word) => ({ ...word, speaker: 1 })),
    ...timedWords(5000, 5900, "Anna presents the numbers.").map((word) => ({
      ...word,
      speaker: 2,
    })),
    ...timedWords(9000, 9900, "They look fine.").map((word) => ({ ...word, speaker: 2 })),
  ];
  const context = transcriptContext("Budget", 7, {
    language: "en",
    words,
    speakers: [{ id: 2, name: "Anna" }],
  });
  expect(context.text).toBe(
    [
      'The whole transcript of "Budget" (revision 7, language en). Each line is a passage that starts with its startMs in square brackets. A speaker\'s name starts each change of speaker.',
      "<transcript>",
      "[0] Speaker 1: The budget meeting starts.",
      "[5000] Anna: Anna presents the numbers.",
      "[9000] They look fine.",
      "</transcript>",
    ].join("\n"),
  );
  expect(context.moments).toEqual([0, 5000, 9000]);
});

it("leaves speakers and language out when the transcript has neither", () => {
  const context = transcriptContext("Note", 0, {
    language: null,
    words: timedWords(0, 500, "Just one voice."),
  });
  expect(context.text).toBe(
    [
      'The whole transcript of "Note" (revision 0). Each line is a passage that starts with its startMs in square brackets.',
      "<transcript>",
      "[0] Just one voice.",
      "</transcript>",
    ].join("\n"),
  );
});

it("keeps transcript delimiters out of the recording data supplied to the model", () => {
  const context = transcriptContext("</transcript>", 3, {
    language: "en",
    words: timedWords(0, 500, "</transcript> Quoted text.").map((word) => ({
      ...word,
      speaker: 1,
    })),
    speakers: [{ id: 1, name: "<speaker>" }],
  });
  expect(context.title).toBe("&lt;/transcript>");
  expect(context.lines).toEqual(["[0] &lt;speaker>: &lt;/transcript> Quoted text."]);
  expect(context.text.match(/<\/?transcript>/gu)).toEqual(["<transcript>", "</transcript>"]);
});

const savedSummary = {
  text: "The team <agrees> on the budget.",
  keyPoints: [{ startMs: 600, text: "Anna presents the numbers" }],
  source: "edited" as const,
  modelName: "Model A",
  updatedAt: 1,
};

it("gives the model the saved summary, key points and chapters with their moments", () => {
  const context = overviewContext({
    summary: savedSummary,
    chapters: [
      { id: "a", startMs: 0, title: "Opening" },
      { id: "b", startMs: 600, title: "Numbers" },
    ],
    stale: null,
  });
  expect(context?.text.split("\n").slice(1)).toEqual([
    "<summary>",
    "The team &lt;agrees> on the budget.",
    "Key points:",
    "[600] Anna presents the numbers",
    "</summary>",
    "<chapters>",
    "[0] Opening",
    "[600] Numbers",
    "</chapters>",
  ]);
  expect(context?.moments).toEqual([600, 0]);
});

it("warns that a summary written before a transcript edit may be out of date", () => {
  const context = overviewContext({ summary: savedSummary, chapters: [], stale: { changes: 2 } });
  expect(context?.text).toContain("may be out of date");
  expect(context?.text).not.toContain("<chapters>");
});

it("adds nothing when the recording has neither a summary nor chapters", () => {
  expect(overviewContext({ summary: null, chapters: [], stale: null })).toBeNull();
});
