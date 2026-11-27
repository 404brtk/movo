import { describe, expect, it } from "vitest";
import {
  nearestMoment,
  normalizeOverview,
  overviewInstructions,
  parseOverview,
} from "../../../../src/server/overview/model-output.ts";

const moments = [0, 4000, 30_000, 65_000, 130_000, 131_000, 400_000];

describe("model overview output", () => {
  it("reads JSON wrapped in a code fence or surrounding text", () => {
    expect(
      parseOverview(
        'Here it is:\n```json\n{ "summary": "Budget talks.", "keyPoints": [], "chapters": [] }\n```',
        "all",
      ),
    ).toEqual({ summary: "Budget talks.", keyPoints: [], chapters: [] });
  });

  it("rejects answers that are not the requested JSON", () => {
    for (const [answer, scope] of [
      ["No JSON here", "all"],
      ['{ "summary": 3 }', "all"],
      ['{ "summary": "Only a summary" }', "all"],
      ['{ "summary": "  ", "keyPoints": [] }', "summary"],
      [JSON.stringify({ summary: "\u0007", keyPoints: [] }), "summary"],
      ['{ "summary": "Text", "keyPoints": [] }', "chapters"],
      ["{ not json }", "summary"],
    ] as const)
      expect(() => parseOverview(answer, scope)).toThrow(
        "The model's answer wasn't in the expected format",
      );
  });

  it("asks only for the parts being written", () => {
    expect(overviewInstructions("summary")).not.toContain("chapters:");
    expect(overviewInstructions("chapters")).not.toContain("keyPoints:");
    expect(overviewInstructions("all")).toContain('"chapters"');
  });

  it("snaps times to the nearest passage start", () => {
    expect(nearestMoment(moments, 0)).toBe(0);
    expect(nearestMoment(moments, 2000)).toBe(0);
    expect(nearestMoment(moments, 2001)).toBe(4000);
    expect(nearestMoment(moments, 999_999)).toBe(400_000);
  });

  it("keeps ordered key points and merges chapters shorter than a minute", () => {
    expect(
      normalizeOverview(
        {
          summary: "  First line.\r\nSecond\u0007 line.\n\n\n\nThird.  ",
          keyPoints: [
            { startMs: 131_200, text: " Later\npoint " },
            { startMs: 3900, text: "Early point" },
            { startMs: 4100, text: "Same passage" },
            { startMs: 65_000, text: "   " },
          ],
          chapters: [
            { startMs: 5000, title: "Opening" },
            { startMs: 29_000, title: "Too close to the opening" },
            { startMs: 130_000, title: "Budget" },
            { startMs: 131_000, title: "Duplicate topic" },
            { startMs: 400_500, title: "Questions" },
          ],
        },
        moments,
        460_000,
      ),
    ).toEqual({
      summary: "First line.\nSecond  line.\n\nThird.",
      keyPoints: [
        { startMs: 4000, text: "Early point" },
        { startMs: 131_000, text: "Later point" },
      ],
      chapters: [
        { startMs: 0, title: "Opening" },
        { startMs: 130_000, title: "Budget" },
        { startMs: 400_000, title: "Questions" },
      ],
    });
  });

  it("merges a final chapter that ends less than a minute later into the one before", () => {
    const chapters = [
      { startMs: 0, title: "Opening" },
      { startMs: 130_000, title: "Budget" },
      { startMs: 400_000, title: "Thanks" },
    ];
    expect(normalizeOverview({ chapters }, moments, 450_000).chapters).toEqual([
      { startMs: 0, title: "Opening" },
      { startMs: 130_000, title: "Budget" },
    ]);
  });

  it("writes no chapters when fewer than two remain", () => {
    expect(
      normalizeOverview({ chapters: [{ startMs: 0, title: "Everything" }] }, moments, 460_000)
        .chapters,
    ).toEqual([]);
  });
});
