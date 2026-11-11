import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { Schema } from "effect";
import {
  localServers,
  type AiModel,
  type ConnectionKind,
  type LocalServer,
} from "../../shared/contracts/ask.ts";
import { MediaError } from "../media/error.ts";

export interface ConnectionSecret {
  kind: ConnectionKind;
  baseUrl: string | null;
  apiKey: string | null;
}

const listTimeoutMs = 15_000;
const localProbeTimeoutMs = 1500;
const ollamaShowConcurrency = 4;

const OpenAiModels = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({ id: Schema.String, owned_by: Schema.optional(Schema.String) }),
  ),
});
const LlamaCppProps = Schema.Struct({
  default_generation_settings: Schema.optional(
    Schema.Struct({ n_ctx: Schema.optional(Schema.Number) }),
  ),
  chat_template_caps: Schema.optional(
    Schema.Struct({ supports_tools: Schema.optional(Schema.Boolean) }),
  ),
});
const AnthropicModels = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      display_name: Schema.String,
      max_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
      lifecycle: Schema.optional(Schema.String),
    }),
  ),
  has_more: Schema.Boolean,
  last_id: Schema.NullOr(Schema.String),
});
const OpenRouterModels = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      context_length: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
});
const OllamaShow = Schema.Struct({ capabilities: Schema.optional(Schema.Array(Schema.String)) });
const OllamaRunning = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({ name: Schema.String, context_length: Schema.optional(Schema.Number) }),
  ),
});
const LmStudioModels = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      capabilities: Schema.optional(
        Schema.Struct({ trained_for_tool_use: Schema.optional(Schema.Boolean) }),
      ),
      loaded_instances: Schema.optional(
        Schema.Array(
          Schema.Struct({
            config: Schema.optional(
              Schema.Struct({ context_length: Schema.optional(Schema.Number) }),
            ),
          }),
        ),
      ),
    }),
  ),
});

async function requestJson<S extends Schema.ConstraintDecoder<unknown>>(
  source: string,
  url: string,
  init: Omit<RequestInit, "signal"> & { timeoutMs: number; signal?: AbortSignal | undefined },
  schema: S,
): Promise<S["Type"]> {
  const { timeoutMs, signal, ...request } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...request,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    throw new MediaError(
      "unavailable",
      timeout.aborted ? `${source} didn't answer in time.` : `${source} couldn't be reached.`,
      cause,
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new MediaError(
      "invalid",
      source === "The server"
        ? "The server didn't accept this key."
        : `${source} didn't accept this key. Copy it again — ${source} shows a key only once.`,
    );
  if (!response.ok)
    throw new MediaError("unavailable", `${source} answered with HTTP ${response.status}.`);
  try {
    return Schema.decodeUnknownSync(schema)(await response.json());
  } catch (cause) {
    throw new MediaError("unavailable", `${source} returned a model list Movo can't read.`, cause);
  }
}

const bearer = (apiKey: string | null): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

const nonChatOpenAiFamilies =
  /embedding|tts|whisper|transcribe|dall-e|image|moderation|realtime|audio|sora|babbage|davinci|search/u;

export const isOpenAiChatModel = (id: string) => !nonChatOpenAiFamilies.test(id);

async function listAnthropic(apiKey: string, signal?: AbortSignal) {
  const models: AiModel[] = [];
  let after: string | null = null;
  do {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("lifecycle", "active");
    if (after) url.searchParams.set("after_id", after);
    const page: typeof AnthropicModels.Type = await requestJson(
      "Anthropic",
      url.href,
      {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal,
        timeoutMs: listTimeoutMs,
      },
      AnthropicModels,
    );
    for (const model of page.data)
      if ((model.lifecycle ?? "active") === "active")
        models.push({
          id: model.id,
          name: model.display_name,
          contextTokens: model.max_input_tokens ?? null,
          tools: "yes",
        });
    after = page.has_more ? page.last_id : null;
  } while (after);
  return models;
}

async function listOpenAi(apiKey: string, signal?: AbortSignal) {
  const page = await requestJson(
    "OpenAI",
    "https://api.openai.com/v1/models",
    { headers: bearer(apiKey), signal, timeoutMs: listTimeoutMs },
    OpenAiModels,
  );
  return page.data
    .filter((model) => isOpenAiChatModel(model.id))
    .map((model): AiModel => ({ id: model.id, name: model.id, contextTokens: null, tools: "yes" }))
    .toSorted((first, second) => second.id.localeCompare(first.id));
}

async function listOpenRouter(apiKey: string, signal?: AbortSignal) {
  const request = { headers: bearer(apiKey), signal, timeoutMs: listTimeoutMs };
  const [, page] = await Promise.all([
    requestJson("OpenRouter", "https://openrouter.ai/api/v1/key", request, Schema.Unknown),
    requestJson(
      "OpenRouter",
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
      request,
      OpenRouterModels,
    ),
  ]);
  return page.data.map((model): AiModel => ({
    id: model.id,
    name: model.name,
    contextTokens: model.context_length ?? null,
    tools: "yes",
  }));
}

async function ollamaToolSupport(baseUrl: string, apiKey: string | null, id: string) {
  try {
    const shown = await requestJson(
      "The server",
      `${baseUrl}/api/show`,
      {
        method: "POST",
        headers: { ...bearer(apiKey), "content-type": "application/json" },
        body: JSON.stringify({ model: id }),
        timeoutMs: localProbeTimeoutMs * 2,
      },
      OllamaShow,
    );
    if (!shown.capabilities) return "unknown";
    return shown.capabilities.includes("tools") ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

type ServerDetails = Map<string, Pick<AiModel, "tools" | "contextTokens">>;

async function lmStudioDetails(baseUrl: string, apiKey: string | null): Promise<ServerDetails> {
  const listing = await requestJson(
    "The server",
    `${baseUrl}/api/v1/models`,
    { headers: bearer(apiKey), timeoutMs: localProbeTimeoutMs * 2 },
    LmStudioModels,
  );
  return new Map(
    listing.models.map((model) => [
      model.key,
      {
        tools:
          model.capabilities?.trained_for_tool_use === undefined
            ? "unknown"
            : model.capabilities.trained_for_tool_use
              ? "yes"
              : "no",
        contextTokens: model.loaded_instances?.[0]?.config?.context_length ?? null,
      },
    ]),
  );
}

async function ollamaDetails(
  baseUrl: string,
  apiKey: string | null,
  ids: readonly string[],
): Promise<ServerDetails> {
  const running = await requestJson(
    "The server",
    `${baseUrl}/api/ps`,
    { headers: bearer(apiKey), timeoutMs: localProbeTimeoutMs * 2 },
    OllamaRunning,
  );
  const contexts = new Map(
    running.models.map((model) => [model.name, model.context_length ?? null]),
  );
  const details: ServerDetails = new Map();
  for (let start = 0; start < ids.length; start += ollamaShowConcurrency) {
    const batch = ids.slice(start, start + ollamaShowConcurrency);
    const support = await Promise.all(batch.map((id) => ollamaToolSupport(baseUrl, apiKey, id)));
    batch.forEach((id, index) =>
      details.set(id, {
        tools: support[index] ?? "unknown",
        contextTokens: contexts.get(id) ?? null,
      }),
    );
  }
  return details;
}

async function llamaCppDetails(
  baseUrl: string,
  apiKey: string | null,
  ids: readonly string[],
): Promise<ServerDetails> {
  const props = await requestJson(
    "The server",
    `${baseUrl}/props`,
    { headers: bearer(apiKey), timeoutMs: localProbeTimeoutMs * 2 },
    LlamaCppProps,
  );
  const supportsTools = props.chat_template_caps?.supports_tools;
  const detail = {
    tools: supportsTools === undefined ? "unknown" : supportsTools ? "yes" : "no",
    contextTokens: props.default_generation_settings?.n_ctx ?? null,
  } as const;
  return new Map(ids.map((id) => [id, detail]));
}

async function serverDetails(
  baseUrl: string,
  apiKey: string | null,
  ids: readonly string[],
  llamaCpp: boolean,
) {
  if (llamaCpp)
    try {
      return await llamaCppDetails(baseUrl, apiKey, ids);
    } catch {
      return new Map() as ServerDetails;
    }
  try {
    return await lmStudioDetails(baseUrl, apiKey);
  } catch {
    try {
      return await ollamaDetails(baseUrl, apiKey, ids);
    } catch {
      return new Map() as ServerDetails;
    }
  }
}

async function listServer(baseUrl: string, apiKey: string | null, signal?: AbortSignal) {
  const page = await requestJson(
    "The server",
    `${baseUrl}/v1/models`,
    { headers: bearer(apiKey), signal, timeoutMs: listTimeoutMs },
    OpenAiModels,
  );
  const ids = page.data.map((model) => model.id);
  const details = await serverDetails(
    baseUrl,
    apiKey,
    ids,
    page.data.some((model) => model.owned_by === "llamacpp"),
  );
  return ids.map((id): AiModel => ({
    id,
    name: id,
    contextTokens: details.get(id)?.contextTokens ?? null,
    tools: details.get(id)?.tools ?? "unknown",
  }));
}

const modelLists: Record<
  ConnectionKind,
  (connection: ConnectionSecret, signal?: AbortSignal) => Promise<AiModel[]>
> = {
  anthropic: (connection, signal) => listAnthropic(connection.apiKey ?? "", signal),
  openai: (connection, signal) => listOpenAi(connection.apiKey ?? "", signal),
  openrouter: (connection, signal) => listOpenRouter(connection.apiKey ?? "", signal),
  server: (connection, signal) => listServer(connection.baseUrl ?? "", connection.apiKey, signal),
};

export const listModels = (connection: ConnectionSecret, signal?: AbortSignal) =>
  modelLists[connection.kind](connection, signal);

export async function detectLocalServers(signal?: AbortSignal) {
  const found = await Promise.all(
    localServers.map(async ({ name, port, ownedBy }): Promise<LocalServer | null> => {
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        const page = await requestJson(
          name,
          `${baseUrl}/v1/models`,
          { signal, timeoutMs: localProbeTimeoutMs },
          OpenAiModels,
        );
        if (ownedBy && !page.data.some((model) => model.owned_by === ownedBy)) return null;
        return { name, baseUrl, modelIds: page.data.map((model) => model.id) };
      } catch {
        return null;
      }
    }),
  );
  return found.filter((server) => server !== null);
}

const keyOf = (connection: ConnectionSecret) =>
  connection.apiKey ? { apiKey: connection.apiKey } : {};

const modelFactories: Record<
  ConnectionKind,
  (connection: ConnectionSecret, modelId: string) => LanguageModel
> = {
  anthropic: (connection, modelId) => createAnthropic(keyOf(connection))(modelId),
  openai: (connection, modelId) => createOpenAI(keyOf(connection))(modelId),
  openrouter: (connection, modelId) => createOpenRouter(keyOf(connection))(modelId),
  server: (connection, modelId) =>
    createOpenAICompatible({
      name: "server",
      baseURL: `${connection.baseUrl}/v1`,
      ...keyOf(connection),
    })(modelId),
};

export const languageModel = (connection: ConnectionSecret, modelId: string) =>
  modelFactories[connection.kind](connection, modelId);
