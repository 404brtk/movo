import type { TranscriptionResult, Word } from "transcribe-cpp";
import { describe, expect, it } from "vitest";
import { readEngineTranscript } from "../../../../src/server/transcriptions/engine-result.ts";

const word = (text: string, t0Ms: number, t1Ms: number): Word => ({
  text,
  t0Ms,
  t1Ms,
  segIndex: 0,
  firstToken: 0,
  nTokens: 1,
});

const engineResult = (overrides: Partial<TranscriptionResult>): TranscriptionResult => ({
  text: "",
  rawText: "",
  language: "",
  timestampKind: "none",
  segments: [],
  speakerSegments: [],
  words: [],
  tokens: [],
  timings: { loadMs: 0, melMs: 0, encodeMs: 0, decodeMs: 0 },
  aborted: false,
  truncated: false,
  ...overrides,
});

describe("engine result", () => {
  it("reads a recording without speech as an empty transcript", () => {
    expect(readEngineTranscript(engineResult({ text: " " }))).toEqual({
      language: null,
      words: [],
    });
  });

  it("keeps trimmed timestamped words and the detected language", () => {
    expect(
      readEngineTranscript(
        engineResult({
          text: "Hello there",
          language: "en",
          timestampKind: "word",
          words: [word(" Hello", 0, 400), word(" ", 400, 450), word("there ", 450, 900)],
        }),
      ),
    ).toEqual({
      language: "en",
      words: [
        { startMs: 0, endMs: 400, text: "Hello" },
        { startMs: 450, endMs: 900, text: "there" },
      ],
    });
  });

  it.each([
    {
      name: "an aborted run",
      result: engineResult({ aborted: true }),
      message: "The engine did not transcribe the whole recording.",
    },
    {
      name: "a truncated run",
      result: engineResult({ truncated: true }),
      message: "The engine did not transcribe the whole recording.",
    },
    {
      name: "text without word timestamps",
      result: engineResult({ text: "Hello", timestampKind: "segment" }),
      message: "The engine did not return word timestamps.",
    },
    {
      name: "words without word timestamps",
      result: engineResult({ words: [word("Hello", 0, 400)] }),
      message: "The engine did not return word timestamps.",
    },
    {
      name: "text without words",
      result: engineResult({ text: "Hello", timestampKind: "word" }),
      message: "The engine returned text without timestamped words.",
    },
  ])("rejects $name", ({ result, message }) => {
    expect(() => readEngineTranscript(result)).toThrow(message);
  });
});
