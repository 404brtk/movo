import { describe, expect, it } from "vitest";
import type { AiConnection, ChatMessage, ChatPart } from "../../../../src/shared/contracts/ask.ts";
import type {
  TranscriptionJob,
  TranscriptWord,
} from "../../../../src/shared/contracts/transcriptions.ts";
import {
  connectionLabel,
  editReceipt,
  editRevision,
  isEditTool,
  mediaLink,
  modelChanges,
  proposedChange,
  revealHiddenCharacters,
  stepReceipt,
  toolLabel,
} from "../../../../src/web/lib/ask-view.ts";

const id = "0b6f7c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";

describe("mediaLink", () => {
  it("opens recordings at a moment and ignores every other link", () => {
    expect(mediaLink(`/media/${id}?startMs=754000`)).toEqual({ mediaId: id, startMs: 754000 });
    expect(mediaLink(`/media/${id}`)).toEqual({ mediaId: id, startMs: undefined });
    expect(mediaLink(`https://example.com/media/${id}`)).toBeNull();
    expect(mediaLink(`/media/${id}?startMs=-1`)).toBeNull();
    expect(mediaLink("javascript:alert(1)")).toBeNull();
    expect(mediaLink(undefined)).toBeNull();
  });
});

it("shows zero-width and bidirectional control characters", () => {
  const rightToLeftOverride = String.fromCodePoint(0x202e);
  const zeroWidthSpace = String.fromCodePoint(0x200b);
  expect(revealHiddenCharacters(`pay${rightToLeftOverride}exe.txt${zeroWidthSpace}`)).toBe(
    "pay[U+202E]exe.txt[U+200B]",
  );
  expect(revealHiddenCharacters("Zażółć 🎙")).toBe("Zażółć 🎙");
});

const message = (seq: number, modelName: string | null): ChatMessage => ({
  seq,
  role: modelName ? "assistant" : "user",
  state: "done",
  modelName,
  error: null,
  errorKind: null,
  passage: null,
  parts: [],
  moments: [],
  createdAt: 1,
});

it("marks where another model starts answering", () => {
  expect(
    modelChanges([
      message(1, null),
      message(2, "Model A"),
      message(3, null),
      message(4, "Model A"),
      message(5, null),
      message(6, "qwen3:8b"),
    ]),
  ).toEqual(new Map([[6, "qwen3:8b"]]));
});

it("names connections by provider or by local server", () => {
  const base: AiConnection = {
    id,
    kind: "server",
    baseUrl: "http://127.0.0.1:11434",
    reach: "this-computer",
    keyHint: null,
    createdAt: 1,
  };
  expect(connectionLabel(base)).toBe("Ollama on this computer");
  expect(connectionLabel({ ...base, baseUrl: "http://192.168.1.20:8080", reach: "network" })).toBe(
    "llama-server on 192.168.1.20",
  );
  expect(connectionLabel({ ...base, baseUrl: "http://192.168.1.20:8000", reach: "network" })).toBe(
    "Server at 192.168.1.20:8000",
  );
  expect(connectionLabel({ ...base, kind: "openrouter", baseUrl: null, reach: null })).toBe(
    "OpenRouter",
  );
});

type ToolPart = Extract<ChatPart, { type: "tool" }>;
const tool = (toolName: string, input: unknown, extra: Partial<ToolPart> = {}): ToolPart => ({
  type: "tool",
  toolName,
  input,
  state: "done",
  approvalId: null,
  resultCount: null,
  ...extra,
});

describe("answer receipts", () => {
  it("names the step in progress and the finished steps", () => {
    const titles = new Map([[id, "Weekly sync"]]);
    expect(toolLabel({ toolName: "read_transcript", input: { mediaId: id } }, "now")).toBe(
      "Reading the transcript",
    );
    expect(toolLabel({ toolName: "read_transcript", input: { mediaId: id } }, "now", titles)).toBe(
      "Reading Weekly sync",
    );
    expect(toolLabel({ toolName: "search_library", input: { q: " budget " } }, "done")).toBe(
      "Searched for “budget”",
    );
    expect(
      stepReceipt(
        [
          tool("search_library", { q: "budget" }),
          tool("read_transcript", { mediaId: id }),
          tool("read_transcript", { mediaId: id, fromMs: 60000 }),
          { type: "text", text: "Answer" },
        ],
        false,
      ),
    ).toBe("Searched for “budget” · Read the transcript");
    expect(
      stepReceipt(
        [
          tool("search_library", { q: "budget" }),
          tool("read_transcript", { mediaId: id }),
          tool("read_transcript", { mediaId: "other" }),
        ],
        true,
      ),
    ).toBe("Searched the library · read 2");
    expect(stepReceipt([tool("read_transcript", {}, { state: "running" })], false)).toBeNull();
  });

  it("describes what an approved or declined change did", () => {
    expect(editReceipt(tool("replace_in_transcript", {}, { resultCount: 3 }))).toBe(
      "Replaced 3 places",
    );
    expect(editReceipt(tool("replace_in_transcript", {}, { resultCount: 1 }))).toBe(
      "Replaced 1 place",
    );
    expect(editReceipt(tool("replace_in_transcript", {}, { resultCount: 0 }))).toBe(
      "Nothing matched, so nothing changed",
    );
    expect(editReceipt(tool("edit_transcript", {}, { state: "denied" }))).toBe("Not changed");
  });

  it("treats speaker tools as approved changes and previews the passage and speakers", () => {
    const assign = tool("assign_speaker", { revision: 4, firstWord: 1, wordCount: 2, speaker: 3 });
    const merge = tool("merge_speakers", { revision: 4, speaker: 2, into: 1 });
    const rename = tool("rename_speaker", { speaker: 2, name: " Ann " });
    const job = speakerJob(4, [
      { startMs: 0, endMs: 500, text: "Hello.", speaker: 1 },
      { startMs: 61000, endMs: 61400, text: "Fine,", speaker: 2 },
      { startMs: 61400, endMs: 62000, text: "thanks.", speaker: 2 },
    ]);
    expect([assign, merge, rename].every(isEditTool)).toBe(true);
    expect([assign, merge, rename].map(editReceipt)).toEqual([
      "Changed the speaker",
      "Merged speakers",
      "Named a speaker",
    ]);
    expect([assign, merge, rename].map((part) => proposedChange(part, job))).toEqual([
      { context: "1:01 “Fine, thanks.”", before: "Bob", after: "Speaker 3" },
      { context: null, before: "Bob", after: "Speaker 1" },
      { context: null, before: "Bob", after: "Ann" },
    ]);
    expect(proposedChange(tool("rename_speaker", { speaker: 2, name: "" }), job).after).toBe(
      "Speaker 2",
    );
    expect([assign, merge, rename].map(editRevision)).toEqual([4, 4, null]);
    expect(stepReceipt([assign, merge, rename], false)).toBeNull();
  });

  it("names only the word range of a speaker change it cannot read in the current transcript", () => {
    const assign = tool("assign_speaker", { revision: 4, firstWord: 0, wordCount: 14, speaker: 2 });
    expect(proposedChange(assign)).toEqual({
      context: "Words 1–14",
      before: null,
      after: "Speaker 2",
    });
    const words = Array.from({ length: 14 }, (_, index) => ({
      startMs: index * 100,
      endMs: index * 100 + 100,
      text: `w${index}`,
      speaker: 1,
    }));
    expect(proposedChange(assign, speakerJob(5, words))).toEqual({
      context: "Words 1–14",
      before: null,
      after: "Bob",
    });
    expect(proposedChange(assign, speakerJob(4, words))).toEqual({
      context: "0:00 “w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11…”",
      before: "Speaker 1",
      after: "Bob",
    });
  });
});

function speakerJob(revision: number, words: TranscriptWord[]): TranscriptionJob {
  return {
    mediaId: id,
    modelId: "parakeet-ultra-q8",
    status: "completed",
    phase: "finished",
    transcript: { language: "en", words, speakers: [{ id: 2, name: "Bob" }] },
    revision,
    resultRevision: 1,
    device: null,
    error: null,
    cleanupError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
