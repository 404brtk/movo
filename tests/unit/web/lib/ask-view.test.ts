import { describe, expect, it } from "vitest";
import type { AiConnection, ChatMessage, ChatPart } from "../../../../src/shared/contracts/ask.ts";
import {
  connectionLabel,
  editReceipt,
  mediaLink,
  modelChanges,
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
});
