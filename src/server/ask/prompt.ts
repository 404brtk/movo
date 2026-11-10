import type { ModelMessage, ToolModelMessage } from "ai";

export interface StoredMessage {
  seq: number;
  role: "user" | "assistant";
  messages: ModelMessage[];
}

export interface ContextCuts {
  toolCutSeq: number;
  contextCutSeq: number;
}

export interface PromptInput {
  rows: readonly StoredMessage[];
  cuts: ContextCuts;
  contextTokens: number;
  prefixCharacters: number;
  charactersPerToken: number;
}

export const trimThreshold = 0.75;
export const keptToolTurns = 2;
export const droppedTurnsPerCut = 4;
const pageShareOfFreeTokens = 0.25;
const tokensPerPassage = 60;
export const minPagePassages = 8;
export const maxChatPagePassages = 50;

const stub = (toolName: string) =>
  `This ${toolName} result was removed to save room. Call ${toolName} again if you need it.`;

function stubToolMessage(message: ToolModelMessage): ToolModelMessage {
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool-result"
        ? { ...part, output: { type: "text", value: stub(part.toolName) } }
        : part,
    ),
  };
}

const stubbed = (messages: readonly ModelMessage[]) =>
  messages.map((message) => (message.role === "tool" ? stubToolMessage(message) : message));

export const messageCharacters = (messages: readonly ModelMessage[]) =>
  JSON.stringify(messages).length;

function render(rows: readonly StoredMessage[], cuts: ContextCuts) {
  return rows
    .filter((row) => row.seq >= cuts.contextCutSeq)
    .flatMap((row) => (row.seq < cuts.toolCutSeq ? stubbed(row.messages) : row.messages));
}

export function buildPrompt(input: PromptInput) {
  const budget = input.contextTokens * trimThreshold;
  const turnStarts = input.rows.filter((row) => row.role === "user").map((row) => row.seq);
  const tokens = (messages: readonly ModelMessage[]) =>
    (input.prefixCharacters + messageCharacters(messages)) / input.charactersPerToken;
  let cuts = { ...input.cuts };
  let messages = render(input.rows, cuts);
  const keptToolStart = turnStarts.at(-keptToolTurns) ?? 0;
  if (tokens(messages) > budget && keptToolStart > cuts.toolCutSeq) {
    cuts = { ...cuts, toolCutSeq: keptToolStart };
    messages = render(input.rows, cuts);
  }
  const lastTurnStart = turnStarts.at(-1) ?? 0;
  while (tokens(messages) > budget && cuts.contextCutSeq < lastTurnStart) {
    const visibleTurns = turnStarts.filter((seq) => seq >= cuts.contextCutSeq);
    const next =
      visibleTurns[Math.min(droppedTurnsPerCut, visibleTurns.length - 1)] ?? lastTurnStart;
    cuts = { ...cuts, contextCutSeq: next };
    messages = render(input.rows, cuts);
  }
  const freeTokens = Math.max(0, input.contextTokens - tokens(messages));
  const pagePassages = Math.min(
    maxChatPagePassages,
    Math.max(minPagePassages, Math.floor((freeTokens * pageShareOfFreeTokens) / tokensPerPassage)),
  );
  return {
    messages,
    cuts,
    promptCharacters: input.prefixCharacters + messageCharacters(messages),
    pagePassages,
  };
}

export function trimStepMessages(
  messages: readonly ModelMessage[],
  initialCount: number,
  maxCharacters: number,
) {
  const result = [...messages];
  let size = messageCharacters(result);
  const lastTool = result.findLastIndex((message) => message.role === "tool");
  for (let index = initialCount; index < lastTool && size > maxCharacters; index++) {
    const message = result[index];
    if (message?.role !== "tool") continue;
    const replaced = stubToolMessage(message);
    size += messageCharacters([replaced]) - messageCharacters([message]);
    result[index] = replaced;
  }
  return result;
}

export const defaultCharactersPerToken = 3.5;

export function calibratedCharactersPerToken(
  measured: { inputTokens: number | null; promptCharacters: number | null } | undefined,
) {
  if (!measured?.inputTokens || !measured.promptCharacters) return defaultCharactersPerToken;
  return Math.min(6, Math.max(2, measured.promptCharacters / measured.inputTokens));
}
