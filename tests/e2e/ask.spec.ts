import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type {
  AiConnection,
  AiModel,
  ChatDetail,
  ChatMessage,
  ChatPart,
  ChatSummary,
  ModelChoice,
} from "../../src/shared/contracts/ask.ts";
import type { LibraryList } from "../../src/shared/contracts/library.ts";
import type { MediaItem } from "../../src/shared/contracts/media.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../helpers/timed-words.ts";

const connection: AiConnection = {
  id: randomUUID(),
  kind: "anthropic",
  baseUrl: null,
  reach: null,
  keyHint: "1234",
  createdAt: Date.now(),
};
const models: AiModel[] = [
  { id: "model-a", name: "Model A", contextTokens: 200_000, tools: "yes" },
  { id: "model-b", name: "Model B", contextTokens: 200_000, tools: "yes" },
];
const choice: ModelChoice = {
  connectionId: connection.id,
  modelId: "model-a",
  modelName: "Model A",
  contextTokens: 200_000,
};
const rejection =
  "Anthropic didn't accept this key. Copy it again — Anthropic shows a key only once.";

const completedJob = (mediaId: string, text: string): TranscriptionJob => ({
  mediaId,
  modelId: "parakeet-ultra-q8",
  status: "completed",
  phase: "finished",
  transcript: { language: "en", words: timedWords(0, 1500, text) },
  revision: 3,
  resultRevision: 0,
  device: null,
  error: null,
  cleanupError: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const summaryOf = (id: string, mediaId: string | null, title: string): ChatSummary => ({
  id,
  mediaId,
  connectionId: connection.id,
  modelId: "model-a",
  modelName: "Model A",
  title,
  scope: null,
  recordingCount: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const userMessage = (text: string): ChatMessage => ({
  seq: 1,
  role: "user",
  state: "done",
  modelName: null,
  error: null,
  errorKind: null,
  passage: null,
  parts: [{ type: "text", text }],
  createdAt: Date.now(),
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

const answerMessage = (state: ChatMessage["state"], parts: ChatPart[]): ChatMessage => ({
  seq: 2,
  role: "assistant",
  state,
  modelName: "Model A",
  error: null,
  errorKind: null,
  passage: null,
  parts: state === "answering" ? [] : parts,
  createdAt: Date.now(),
});

const failedAnswer = (
  seq: number,
  error: string,
  errorKind: ChatMessage["errorKind"],
): ChatMessage => ({ ...answerMessage("failed", []), seq, error, errorKind });

async function connectedModel(page: Page) {
  await page.route("**/api/ask/local", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/ask/connections", (route) => route.fulfill({ json: [connection] }));
  await page.route(`**/api/ask/connections/${connection.id}/models`, (route) =>
    route.fulfill({ json: models }),
  );
  await page.route("**/api/ask/default", (route) => route.fulfill({ json: choice }));
}

const liveBody = (text: string) =>
  `event: snapshot\ndata: ${JSON.stringify({ text, activity: null })}\n\nevent: end\ndata: \n\n`;

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("connects an API key on the Models page after a rejected key and picks the default model", async ({
  page,
}) => {
  let connected = false;
  let saved: ModelChoice | null = null;
  const keys: string[] = [];
  await page.route("**/api/ask/local", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/ask/connections", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: connected ? [connection] : [] });
    const body: { kind: string; apiKey: string } = route.request().postDataJSON();
    keys.push(body.apiKey);
    if (body.apiKey !== "sk-good-1234")
      return route.fulfill({ status: 400, json: { error: rejection } });
    connected = true;
    return route.fulfill({ status: 201, json: connection });
  });
  await page.route(`**/api/ask/connections/${connection.id}/models`, (route) =>
    route.fulfill({ json: models }),
  );
  await page.route("**/api/ask/default", async (route) => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON();
    return route.fulfill({ json: saved });
  });

  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "Transcription", exact: true })).toBeVisible();
  await expect(page.getByText("No model server found")).toBeVisible();
  const anthropic = page.getByRole("listitem").filter({ hasText: "Claude models from Anthropic" });
  await anthropic.getByRole("button", { name: "Add key" }).click();
  const key = page.getByLabel("Anthropic API key");
  await key.fill("sk-wrong-0000");
  await key.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(rejection);
  await expect(key).toHaveValue("sk-wrong-0000");
  await key.fill("sk-good-1234");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Key ending 1234 · 2 models")).toBeVisible();
  expect(keys).toEqual(["sk-wrong-0000", "sk-good-1234"]);
  await expect(page.getByLabel("New chats answer with")).toHaveValue(`${connection.id}\nmodel-a`);
  expect(saved).toEqual(choice);
  await page.getByLabel("New chats answer with").selectOption({ label: "Model B" });
  await expect.poll(() => saved?.modelId).toBe("model-b");
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("sk-good-1234");
  await page.getByRole("button", { name: "Add address" }).click();
  await page.getByLabel("Server address").fill("192.168.1.20:11434");
  await expect(
    page.getByText("Your network · questions cross it unencrypted over http"),
  ).toBeVisible();
  await page.getByLabel("Server address").fill("api.example.com");
  await expect(page.getByText(/^Only this computer or your home network/u)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("asks about a recording in the side panel, streams the answer and applies an approved change", async ({
  page,
  request,
}) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/sample.webm", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.webm` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({ json: completedJob(media.id, "Anna presents the numbers.") }),
  );
  const chatId = randomUUID();
  const summary = summaryOf(chatId, media.id, "Who presents?");
  const question = userMessage("Who presents?");
  const answer = (state: ChatMessage["state"], approval: "pending" | "done") =>
    answerMessage(state, [
      tool("read_transcript", { mediaId: media.id }),
      {
        type: "text",
        text: `Anna presents the numbers at [0:01](/media/${media.id}?startMs=1000).`,
      },
      tool(
        "replace_in_transcript",
        { mediaId: media.id, revision: 3, find: "Anna", replacement: "Hanna" },
        approval === "pending"
          ? { state: "waiting_approval", approvalId: "approval-1" }
          : { resultCount: 1 },
      ),
    ]);
  let detail: ChatDetail = { chat: summary, messages: [], hiddenBeforeSeq: 0 };
  const decisions: unknown[] = [];
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) =>
    route.fulfill({ json: detail.messages.length > 0 ? [summary] : [] }),
  );
  await page.route("**/api/ask/chats", (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ mediaId: media.id, scope: null });
    return route.fulfill({ status: 201, json: detail });
  });
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/ask/chats/${chatId}/messages`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ text: "Who presents?" });
    detail = { ...detail, messages: [question, answer("answering", "pending")] };
    return route.fulfill({ status: 202, json: detail });
  });
  await page.route(`**/api/ask/chats/${chatId}/live`, (route) => {
    detail = { ...detail, messages: [question, answer("waiting_approval", "pending")] };
    return route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: liveBody("Anna presents"),
    });
  });
  await page.route(`**/api/ask/chats/${chatId}/approval`, (route) => {
    decisions.push(route.request().postDataJSON());
    detail = { ...detail, messages: [question, answer("done", "done")] };
    return route.fulfill({ status: 202, json: detail });
  });

  await page.goto(`/media/${media.id}`);
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Ask/u })).toBeVisible();
  await page.keyboard.press("/");
  const composer = panel.getByRole("textbox", { name: "Ask about this recording…" });
  await expect(composer).toBeFocused();
  await expect(panel.getByRole("button", { name: "Model A" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Ask about this recording" })).toBeVisible();
  await expect(
    panel.getByText("Answers can be wrong. Check them against the timestamps."),
  ).toBeVisible();
  await page.keyboard.press("Control+Alt+Slash");
  const findModel = page.getByRole("textbox", { name: "Find a model" });
  await expect(findModel).toBeFocused();
  await findModel.press("ArrowDown");
  await findModel.press("Enter");
  await expect(findModel).toHaveCount(0);
  await expect(panel).toBeVisible();
  await composer.fill("Who presents?");
  await composer.press("Enter");
  await expect(panel.getByText("Who presents?", { exact: true })).toBeVisible();
  const moment = panel.getByRole("link", { name: "0:01" });
  await expect(moment).toHaveAttribute("href", `/media/${media.id}?startMs=1000`);
  await expect(panel.getByText("Read the transcript")).toBeVisible();
  await expect(panel.getByText("Change the transcript?")).toBeVisible();
  await expect(composer).toHaveAttribute("placeholder", "Answer the question above to continue");
  await panel.getByRole("button", { name: "Change", exact: true }).click();
  await expect(panel.getByText("Replaced 1 place")).toBeVisible();
  expect(decisions).toEqual([{ approvalId: "approval-1", approved: true }]);
  await expect(panel.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(composer).toHaveAttribute("placeholder", "Ask a follow-up…");

  await composer.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  await page
    .getByRole("list", { name: "Timestamped passages" })
    .getByText("presents", { exact: false })
    .first()
    .click({ clickCount: 3 });
  await page
    .getByRole("toolbar", { name: "Selected text" })
    .getByRole("button", { name: "Ask about this" })
    .click();
  await expect(panel).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("");
  await expect(panel.getByText("Anna presents the numbers.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Remove the passage" }).click();
  await expect(panel.getByRole("button", { name: "Remove the passage" })).toHaveCount(0);
  await composer.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: /^Ask/u }).click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("names the latest failure once, beside its fix, and keeps earlier failures in the chat", async ({
  page,
}) => {
  const chatId = randomUUID();
  const busy = "Anthropic is busy right now.";
  const rejected = "Anthropic no longer accepts your key.";
  const detail: ChatDetail = {
    chat: summaryOf(chatId, null, "Who presents?"),
    messages: [
      userMessage("Who presents?"),
      failedAnswer(2, busy, "busy"),
      { ...userMessage("Who presents the numbers?"), seq: 3 },
      failedAnswer(4, rejected, "key"),
    ],
    hiddenBeforeSeq: 0,
  };
  await connectedModel(page);
  await page.route("**/api/media", (route) =>
    route.fulfill({ json: { items: [], transcribing: false } satisfies LibraryList }),
  );
  await page.route("**/api/ask/chats", (route) => route.fulfill({ json: [detail.chat] }));
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));

  await page.goto(`/ask?chat=${chatId}`);
  await expect(page.getByRole("alert")).toContainText(rejected);
  await expect(page.getByText(rejected)).toHaveCount(1);
  await expect(page.getByText(busy)).toHaveCount(1);
  await page.getByRole("button", { name: "Update key" }).click();
  await expect(page).toHaveURL(/\/models$/u);
});

test("keeps the chosen model visible in a folded group and starts the keyboard on it", async ({
  page,
}) => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    id: `model-${index + 1}`,
    name: `Model ${index + 1}`,
    contextTokens: 200_000,
    tools: "yes" as const,
  }));
  let saved: ModelChoice = { ...choice, modelId: "model-9", modelName: "Model 9" };
  await page.route("**/api/ask/local", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/ask/connections", (route) => route.fulfill({ json: [connection] }));
  await page.route(`**/api/ask/connections/${connection.id}/models`, (route) =>
    route.fulfill({ json: many }),
  );
  await page.route("**/api/ask/default", (route) => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON();
    return route.fulfill({ json: saved });
  });
  await page.route("**/api/ask/chats", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/media", (route) =>
    route.fulfill({ json: { items: [], transcribing: false } satisfies LibraryList }),
  );

  await page.goto("/ask");
  await page.getByRole("button", { name: "Model 9" }).click();
  const findModel = page.getByRole("textbox", { name: "Find a model" });
  await expect(findModel).toBeFocused();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("button", { name: "Model 9", pressed: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: /^Model \d+$/u })).toHaveCount(1);
  await expect(picker.getByText("11 more — type to find one")).toBeVisible();
  await findModel.press("Enter");
  await expect(findModel).toHaveCount(0);
  expect(saved.modelId).toBe("model-9");
  await page.getByRole("button", { name: "Model 9" }).click();
  await findModel.fill("model 1");
  await findModel.press("ArrowDown");
  await findModel.press("Enter");
  await expect.poll(() => saved.modelId).toBe("model-10");
});

test("asks across the library within a chosen scope and shows the sources grouped by recording", async ({
  page,
}) => {
  const mediaId = randomUUID();
  const recording: MediaItem = {
    id: mediaId,
    title: "Weekly sync",
    originalName: "weekly-sync.wav",
    kind: "audio",
    contentType: "audio/wav",
    byteSize: 1000,
    durationSeconds: 2,
    importedAt: Date.now(),
    sourceUrl: null,
    fileRemovedAt: null,
  };
  const library: LibraryList = {
    items: [{ ...recording, transcription: "done" }],
    transcribing: false,
  };
  const chatId = randomUUID();
  const summary = summaryOf(chatId, null, "Who presents the numbers?");
  const question = userMessage("Who presents the numbers?");
  const answer = (state: ChatMessage["state"]) =>
    answerMessage(state, [
      tool("search_library", { q: "numbers" }, { resultCount: 1 }),
      tool("read_transcript", { mediaId }),
      {
        type: "text",
        text: `Anna does, in [Weekly sync 0:00](/media/${mediaId}?startMs=0).`,
      },
    ]);
  let detail: ChatDetail = {
    chat: { ...summary, scope: { kind: "audio" } },
    messages: [],
    hiddenBeforeSeq: 0,
  };
  const created: unknown[] = [];
  await connectedModel(page);
  await page.route("**/api/media", (route) => route.fulfill({ json: library }));
  await page.route(`**/api/media/${mediaId}/transcription`, (route) =>
    route.fulfill({ json: completedJob(mediaId, "Anna presents the numbers.") }),
  );
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/ask/chats", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: detail.messages.length > 0 ? [detail.chat] : [] });
    created.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: detail });
  });
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/ask/chats/${chatId}/messages`, (route) => {
    detail = { ...detail, messages: [question, answer("answering")] };
    return route.fulfill({ status: 202, json: detail });
  });
  await page.route(`**/api/ask/chats/${chatId}/live`, (route) => {
    detail = { ...detail, messages: [question, answer("done")] };
    return route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: liveBody("Anna"),
    });
  });

  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Ask", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Ask", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("All 1 recording has a transcript.")).toBeVisible();
  await page.getByRole("button", { name: "Scope: All recordings" }).click();
  await page.getByRole("menuitemradio", { name: "Audio" }).click();
  await expect(page.getByRole("button", { name: "Scope: Audio" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Ask across your library…" });
  await composer.fill("Who presents the numbers?");
  await composer.press("Enter");
  expect(created).toEqual([{ mediaId: null, scope: { kind: "audio" } }]);
  await expect(page).toHaveURL(new RegExp(`chat=${chatId}`, "u"));
  await expect(
    page.getByRole("heading", { name: "Who presents the numbers?", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Searched the library · read 1")).toBeVisible();
  const sources = page.getByRole("list", { name: "Sources" });
  await expect(sources.getByText("Weekly sync", { exact: true }).first()).toBeVisible();
  await expect(sources.getByRole("link", { name: "Open Weekly sync" })).toBeVisible();
  await expect(sources.getByRole("link", { name: "0:00" })).toHaveAttribute(
    "href",
    `/media/${mediaId}?startMs=0`,
  );
  await expect(sources.locator("mark", { hasText: "numbers" })).toBeVisible();
  await page.getByRole("link", { name: "Ask", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Who presents the numbers\?.*1 recording · Today/u }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
});
