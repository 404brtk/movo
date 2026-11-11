import { Schema } from "effect";
import { MediaId, mediaKinds } from "./media.ts";

export const providerKinds = ["anthropic", "openai", "openrouter"] as const;
export type ProviderKind = (typeof providerKinds)[number];
export const connectionKinds = [...providerKinds, "server"] as const;
export type ConnectionKind = (typeof connectionKinds)[number];
export const providerNames = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
} as const satisfies Record<ProviderKind, string>;
export const serverReaches = ["this-computer", "network"] as const;
export type ServerReach = (typeof serverReaches)[number];

const Timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const ConnectionId = Schema.String.check(Schema.isUUID(4));
export const ChatId = ConnectionId;
const ApiKey = Schema.String.check(
  Schema.isMinLength(8),
  Schema.isMaxLength(512),
  Schema.isPattern(/^[\x21-\x7e]+$/u),
);
export const maxServerAddressLength = 512;
const ServerAddress = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(maxServerAddressLength),
);

export const ConnectRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(providerKinds), apiKey: ApiKey }),
  Schema.Struct({
    kind: Schema.Literal("server"),
    baseUrl: ServerAddress,
    apiKey: Schema.optional(ApiKey),
  }),
]);
export type ConnectRequest = typeof ConnectRequest.Type;

export const AiConnection = Schema.Struct({
  id: ConnectionId,
  kind: Schema.Literals(connectionKinds),
  baseUrl: Schema.NullOr(Schema.String),
  reach: Schema.NullOr(Schema.Literals(serverReaches)),
  keyHint: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
});
export type AiConnection = typeof AiConnection.Type;
export const AiConnectionList = Schema.Array(AiConnection);

export const toolSupport = ["yes", "no", "unknown"] as const;
export const AiModel = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1)),
  contextTokens: Schema.NullOr(Count),
  tools: Schema.Literals(toolSupport),
});
export type AiModel = typeof AiModel.Type;
export const AiModelList = Schema.Array(AiModel);

export const localServerNames = ["Ollama", "LM Studio", "Jan", "llama-server"] as const;
export const localServers: readonly {
  name: (typeof localServerNames)[number];
  port: number;
  ownedBy?: string;
}[] = [
  { name: "Ollama", port: 11434 },
  { name: "LM Studio", port: 1234 },
  { name: "Jan", port: 1337 },
  { name: "llama-server", port: 8080, ownedBy: "llamacpp" },
];
export const localServerName = (baseUrl: string) =>
  localServers.find((server) => String(server.port) === new URL(baseUrl).port)?.name;
export const LocalServer = Schema.Struct({
  name: Schema.Literals(localServerNames),
  baseUrl: Schema.String,
  modelIds: Schema.Array(Schema.String),
});
export type LocalServer = typeof LocalServer.Type;
export const LocalServerList = Schema.Array(LocalServer);

export const ModelChoice = Schema.Struct({
  connectionId: ConnectionId,
  modelId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  modelName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  contextTokens: Schema.NullOr(Count),
});
export type ModelChoice = typeof ModelChoice.Type;
export const DefaultModel = Schema.NullOr(ModelChoice);

export const maxQuestionCharacters = 8000;
export const maxPassageCharacters = 2000;
export const Passage = Schema.Struct({
  startMs: Count,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maxPassageCharacters)),
});
export type Passage = typeof Passage.Type;
export const ChatQuestion = Schema.Struct({
  text: Schema.String.check(
    Schema.isMaxLength(maxQuestionCharacters),
    Schema.makeFilter((text) => text.trim().length > 0 || "Write a question first."),
  ),
  passage: Schema.optional(Passage),
});
export const maxScopeRecordings = 200;
export const ChatScope = Schema.Struct({
  kind: Schema.optional(Schema.Literals(mediaKinds)),
  mediaIds: Schema.optional(
    Schema.Array(MediaId).check(Schema.isMinLength(1), Schema.isMaxLength(maxScopeRecordings)),
  ),
});
export type ChatScope = typeof ChatScope.Type;
export const NewChat = Schema.Struct({
  mediaId: Schema.NullOr(MediaId),
  scope: Schema.optional(Schema.NullOr(ChatScope)),
});
export const ScopeChange = Schema.Struct({ scope: Schema.NullOr(ChatScope) });
export const ApprovalDecision = Schema.Struct({
  approvalId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  approved: Schema.Boolean,
});
export type ApprovalDecision = typeof ApprovalDecision.Type;

export const answerStates = ["answering", "done", "stopped", "failed", "waiting_approval"] as const;
export type AnswerState = (typeof answerStates)[number];
export const toolActivityStates = [
  "running",
  "done",
  "failed",
  "denied",
  "waiting_approval",
] as const;
export type ToolActivityState = (typeof toolActivityStates)[number];
export const ChatPart = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    toolName: Schema.String,
    input: Schema.Unknown,
    state: Schema.Literals(toolActivityStates),
    approvalId: Schema.NullOr(Schema.String),
    resultCount: Schema.NullOr(Count),
  }),
]);
export type ChatPart = typeof ChatPart.Type;
export const failureKinds = ["busy", "key", "server", "tools", "model", "other"] as const;
export type FailureKind = (typeof failureKinds)[number];
export const ChatMessage = Schema.Struct({
  seq: Count,
  role: Schema.Literals(["user", "assistant"]),
  state: Schema.Literals(answerStates),
  modelName: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  errorKind: Schema.NullOr(Schema.Literals(failureKinds)),
  passage: Schema.NullOr(Passage),
  parts: Schema.Array(ChatPart),
  createdAt: Timestamp,
});
export type ChatMessage = typeof ChatMessage.Type;
export const ChatSummary = Schema.Struct({
  id: ChatId,
  mediaId: Schema.NullOr(MediaId),
  connectionId: Schema.NullOr(ConnectionId),
  modelId: Schema.String,
  modelName: Schema.String,
  title: Schema.String,
  scope: Schema.NullOr(ChatScope),
  recordingCount: Count,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ChatSummary = typeof ChatSummary.Type;
export const ChatList = Schema.Array(ChatSummary);
export const ChatMoment = Schema.Struct({ startMs: Count, mediaId: MediaId });
export type ChatMoment = typeof ChatMoment.Type;
export const ChatDetail = Schema.Struct({
  chat: ChatSummary,
  messages: Schema.Array(ChatMessage),
  hiddenBeforeSeq: Count,
  moments: Schema.Array(ChatMoment),
});
export type ChatDetail = typeof ChatDetail.Type;
export const ChatListQuery = Schema.Struct({ mediaId: Schema.optional(MediaId) });

export const LiveActivity = Schema.NullOr(
  Schema.Struct({ toolName: Schema.String, input: Schema.Unknown }),
);
export type LiveActivity = typeof LiveActivity.Type;
export const LiveSnapshot = Schema.Struct({ text: Schema.String, activity: LiveActivity });
