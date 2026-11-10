import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { listModels } from "../../../../src/server/ask/providers.ts";
import { MediaError } from "../../../../src/server/media/error.ts";

type Handler = (path: string, body: string) => { status?: number; json?: unknown } | undefined;

async function serve(handler: Handler) {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const path = request.url ?? "";
      requests.push(`${request.method} ${path} ${request.headers.authorization ?? ""}`.trim());
      const reply = handler(path, body);
      response.statusCode = reply?.status ?? (reply ? 200 : 404);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(reply?.json ?? { error: "not found" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server has no port.");
  const { port } = address;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

const openAiList = (ids: string[]) => ({
  json: { object: "list", data: ids.map((id) => ({ id })) },
});

const openRouterReplies = (keyStatus: number) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://openrouter.ai/api/v1/key")
      return Response.json({ data: { label: "movo" } }, { status: keyStatus });
    return Response.json({
      data: [{ id: "anthropic/claude", name: "Anthropic: Claude", context_length: 200_000 }],
    });
  });

describe("OpenRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a key its public model list would accept", async () => {
    openRouterReplies(401);
    await expect(
      listModels({ kind: "openrouter", baseUrl: null, apiKey: "sk-or-dead" }),
    ).rejects.toEqual(
      new MediaError(
        "invalid",
        "OpenRouter didn't accept this key. Copy it again — OpenRouter shows a key only once.",
      ),
    );
  });

  it("lists tool-capable models for a key it accepts", async () => {
    const fetch = openRouterReplies(200);
    expect(await listModels({ kind: "openrouter", baseUrl: null, apiKey: "sk-or-live" })).toEqual([
      { id: "anthropic/claude", name: "Anthropic: Claude", contextTokens: 200_000, tools: "yes" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("own server model lists", () => {
  it("reads tool support and the loaded context from LM Studio", async () => {
    const { baseUrl } = await serve((path) => {
      if (path === "/v1/models") return openAiList(["qwen2.5-7b-instruct", "tiny-model"]);
      if (path === "/api/v1/models")
        return {
          json: {
            models: [
              {
                type: "llm",
                key: "qwen2.5-7b-instruct",
                capabilities: { vision: false, trained_for_tool_use: true },
                loaded_instances: [{ id: "qwen", config: { context_length: 16384 } }],
                max_context_length: 32768,
              },
              {
                type: "llm",
                key: "tiny-model",
                capabilities: { vision: false, trained_for_tool_use: false },
                loaded_instances: [],
              },
            ],
          },
        };
      return undefined;
    });
    expect(await listModels({ kind: "server", baseUrl, apiKey: null })).toEqual([
      {
        id: "qwen2.5-7b-instruct",
        name: "qwen2.5-7b-instruct",
        contextTokens: 16384,
        tools: "yes",
      },
      { id: "tiny-model", name: "tiny-model", contextTokens: null, tools: "no" },
    ]);
  });

  it("reads tool support from Ollama's model details and the context of running models", async () => {
    const { baseUrl, requests } = await serve((path, body) => {
      if (path === "/v1/models") return openAiList(["qwen3:8b", "gemma:2b"]);
      if (path === "/api/ps")
        return {
          json: { models: [{ name: "qwen3:8b", model: "qwen3:8b", context_length: 4096 }] },
        };
      if (path === "/api/show")
        return {
          json: {
            capabilities: body.includes("qwen3") ? ["completion", "tools"] : ["completion"],
          },
        };
      return undefined;
    });
    expect(await listModels({ kind: "server", baseUrl, apiKey: "local-key-1" })).toEqual([
      { id: "qwen3:8b", name: "qwen3:8b", contextTokens: 4096, tools: "yes" },
      { id: "gemma:2b", name: "gemma:2b", contextTokens: null, tools: "no" },
    ]);
    expect(requests).toContain("GET /v1/models Bearer local-key-1");
  });

  it("lists models of other OpenAI-compatible servers without capability data", async () => {
    const { baseUrl } = await serve((path) =>
      path === "/v1/models" ? openAiList(["llama"]) : undefined,
    );
    expect(await listModels({ kind: "server", baseUrl, apiKey: null })).toEqual([
      { id: "llama", name: "llama", contextTokens: null, tools: "unknown" },
    ]);
  });

  it("reports a server that rejects the key", async () => {
    const { baseUrl } = await serve(() => ({ status: 401, json: { error: "unauthorized" } }));
    await expect(listModels({ kind: "server", baseUrl, apiKey: "wrong-key" })).rejects.toEqual(
      new MediaError("invalid", "The server didn't accept this key."),
    );
  });
});
