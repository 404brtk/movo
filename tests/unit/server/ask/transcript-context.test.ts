import { expect, it } from "vitest";
import { transcriptContext } from "../../../../src/server/ask/transcript-context.ts";
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
