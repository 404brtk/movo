import { describe, expect, it } from "vitest";
import type { Transcript } from "../../../src/shared/contracts/transcriptions.ts";
import { exportTranscript, transcriptText } from "../../../src/shared/transcript-export.ts";

const transcript: Transcript = {
  language: "pl",
  words: [
    { startMs: 125, endMs: 59999, text: "Zażółć." },
    { startMs: 3600001, endMs: 3601000, text: "Second" },
    { startMs: 3601000, endMs: 3602345, text: "passage." },
  ],
};

describe("transcript export", () => {
  it("uses the same plain text for copying and TXT, one passage per line with literal markup", () => {
    const value: Transcript = {
      language: null,
      words: [
        { startMs: 0, endMs: 300, text: "A" },
        { startMs: 300, endMs: 600, text: "&" },
        { startMs: 600, endMs: 1000, text: "<b>B</b>." },
        { startMs: 1000, endMs: 2000, text: "Zażółć." },
      ],
    };
    const expected = "A & <b>B</b>.\nZażółć.";
    expect(transcriptText(value)).toBe(expected);
    expect(exportTranscript(value, "txt")).toBe(expected);
  });

  it("writes numbered SRT cues with millisecond precision and hour boundaries", () => {
    expect(exportTranscript(transcript, "srt")).toBe(
      "1\n00:00:00,125 --> 00:00:59,999\nZażółć.\n\n" +
        "2\n01:00:00,001 --> 01:00:02,345\nSecond passage.\n\n",
    );
  });

  it("writes a WebVTT header and dot-separated milliseconds", () => {
    expect(exportTranscript(transcript, "vtt")).toBe(
      "WEBVTT\n\n" +
        "1\n00:00:00.125 --> 00:00:59.999\nZażółć.\n\n" +
        "2\n01:00:00.001 --> 01:00:02.345\nSecond passage.\n\n",
    );
  });

  it.each(["srt", "vtt"] as const)("escapes subtitle markup in %s", (format) => {
    const value: Transcript = {
      language: null,
      words: [
        { startMs: 0, endMs: 200, text: "A" },
        { startMs: 200, endMs: 400, text: "&" },
        { startMs: 400, endMs: 600, text: "<b>B</b>" },
        { startMs: 600, endMs: 800, text: "-->" },
        { startMs: 800, endMs: 1000, text: "C." },
      ],
    };
    expect(exportTranscript(value, format)).toContain("A &amp; &lt;b&gt;B&lt;/b&gt; --&gt; C.\n\n");
  });

  it("keeps long durations, overlaps and zero-duration passage text", () => {
    const value: Transcript = {
      language: null,
      words: [
        { startMs: 90000000, endMs: 90002000, text: "First." },
        { startMs: 90001000, endMs: 90001000, text: "Second." },
      ],
    };
    expect(exportTranscript(value, "vtt")).toBe(
      "WEBVTT\n\n1\n25:00:00.000 --> 25:00:02.000\nFirst.\n\n" +
        "2\n25:00:01.000 --> 25:00:01.001\nSecond.\n\n",
    );
  });

  it("exports an empty result without inventing cues or text", () => {
    const empty: Transcript = { language: null, words: [] };
    expect(transcriptText(empty)).toBe("");
    expect(exportTranscript(empty, "txt")).toBe("");
    expect(exportTranscript(empty, "srt")).toBe("");
    expect(exportTranscript(empty, "vtt")).toBe("WEBVTT\n\n");
  });
});

describe("speaker labels", () => {
  const conversation: Transcript = {
    language: "en",
    words: [
      { startMs: 0, endMs: 500, text: "Hello.", speaker: 1 },
      { startMs: 600, endMs: 1000, text: "Again.", speaker: 1 },
      { startMs: 1200, endMs: 1500, text: "<Hi>.", speaker: 2 },
    ],
    speakers: [{ id: 2, name: "Ann & Co" }],
  };

  it("names each turn once in plain text and separates turns with a blank line", () => {
    expect(transcriptText(conversation)).toBe("Speaker 1: Hello.\nAgain.\n\nAnn & Co: <Hi>.");
  });

  it("names a turn in its first SRT cue and every WebVTT cue as an escaped voice", () => {
    expect(exportTranscript(conversation, "srt")).toBe(
      "1\n00:00:00,000 --> 00:00:00,500\nSpeaker 1: Hello.\n\n" +
        "2\n00:00:00,600 --> 00:00:01,000\nAgain.\n\n" +
        "3\n00:00:01,200 --> 00:00:01,500\nAnn &amp; Co: &lt;Hi&gt;.\n\n",
    );
    expect(exportTranscript(conversation, "vtt")).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:00.500\n<v Speaker 1>Hello.\n\n" +
        "2\n00:00:00.600 --> 00:00:01.000\n<v Speaker 1>Again.\n\n" +
        "3\n00:00:01.200 --> 00:00:01.500\n<v Ann &amp; Co>&lt;Hi&gt;.\n\n",
    );
  });

  it("leaves a single unnamed speaker unlabeled but labels a named one", () => {
    const alone: Transcript = {
      language: null,
      words: [{ startMs: 0, endMs: 500, text: "Solo.", speaker: 1 }],
    };
    expect(transcriptText(alone)).toBe("Solo.");
    expect(transcriptText({ ...alone, speakers: [{ id: 1, name: "Ann" }] })).toBe("Ann: Solo.");
  });
});
