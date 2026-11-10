import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { describeFailure } from "../../../../src/server/ask/ask.ts";

const apiError = (statusCode: number, message = "failed") =>
  new APICallError({
    message,
    url: "https://example.com/v1/chat",
    requestBodyValues: {},
    statusCode,
  });
const anthropic = { kind: "anthropic", baseUrl: null } as const;
const ollama = { kind: "server", baseUrl: "http://127.0.0.1:11434" } as const;

describe("describeFailure", () => {
  it.each([
    [apiError(401), anthropic, { kind: "key", message: "Anthropic no longer accepts your key." }],
    [apiError(404), anthropic, { kind: "model", message: "Model A isn't available any more." }],
    [
      apiError(529),
      anthropic,
      { kind: "busy", message: "Anthropic didn't answer. It may be busy." },
    ],
    [
      apiError(429),
      anthropic,
      { kind: "busy", message: "Anthropic didn't answer. It may be busy." },
    ],
    [
      apiError(400, "registry.ollama.ai/library/gemma:2b does not support tools"),
      ollama,
      { kind: "tools", message: "Model A can't read transcripts." },
    ],
    [
      new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:11434") }),
      ollama,
      { kind: "server", message: "Ollama isn't running." },
    ],
    [
      apiError(400, "max_tokens is too large"),
      anthropic,
      { kind: "other", message: "Anthropic didn't answer: max_tokens is too large" },
    ],
    [
      new Error("Unexpected end of stream"),
      anthropic,
      { kind: "other", message: "Anthropic didn't answer: Unexpected end of stream" },
    ],
  ])("names %s", (error, connection, expected) => {
    expect(describeFailure(error, connection, "Model A")).toEqual(expected);
  });
});
