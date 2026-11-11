import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
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
  moments: [],
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

const answerMessage = (
  state: ChatMessage["state"],
  parts: ChatPart[],
  moments: ChatMessage["moments"] = [],
): ChatMessage => ({
  seq: 2,
  role: "assistant",
  state,
  modelName: "Model A",
  error: null,
  errorKind: null,
  passage: null,
  parts: state === "answering" ? [] : parts,
  moments,
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
  const defaultField = page.getByRole("button", { name: "New chats answer with: Model A" });
  await expect(defaultField).toContainText("Anthropic");
  expect(saved).toEqual(choice);
  await defaultField.click();
  await page.getByRole("dialog").getByRole("button", { name: "Model B" }).click();
  await expect.poll(() => saved?.modelId).toBe("model-b");
  await expect(page.getByRole("button", { name: "New chats answer with: Model B" })).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("sk-good-1234");
  await page.getByRole("button", { name: "Add address" }).click();
  await page.getByLabel("Server address").fill("192.168.1.20:11434");
  await expect(
    page.getByText("Your network · questions cross it unencrypted over http"),
  ).toBeVisible();
  await page.getByLabel("Server address").fill("api.example.com");
  await expect(page.getByText(/^Only this computer or your home network/u)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => noHorizontalScroll(page)).toBe(true);
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
  let revision = 3;
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({ json: { ...completedJob(media.id, "Anna presents the numbers."), revision } }),
  );
  const chatId = randomUUID();
  const summary = summaryOf(chatId, media.id, "Who presents?");
  const question = userMessage("Who presents?");
  const answer = (state: ChatMessage["state"], approval: "pending" | "done") =>
    answerMessage(
      state,
      [
        tool("read_transcript", { mediaId: media.id }),
        {
          type: "text",
          text: "Anna presents the numbers at [1000].",
        },
        tool(
          "replace_in_transcript",
          { mediaId: media.id, revision: 3, find: "Anna", replacement: "Hanna" },
          approval === "pending"
            ? { state: "waiting_approval", approvalId: "approval-1" }
            : { resultCount: 1 },
        ),
      ],
      [{ startMs: 1000, mediaId: media.id }],
    );
  let detail: ChatDetail = {
    chat: summary,
    messages: [],
    hiddenBeforeSeq: 0,
  };
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
    revision = 4;
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
  await expect(page.getByRole("dialog").getByRole("button", { name: "Model B" })).toBeVisible();
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
  revision = 5;
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
  await expect(panel.getByText("Replaced 1 place")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(panel.getByText("Anna presents the numbers.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Remove the passage" }).click();
  await expect(panel.getByRole("button", { name: "Remove the passage" })).toHaveCount(0);
  await composer.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: /^Ask/u }).click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => noHorizontalScroll(page)).toBe(true);
});

test("wraps the transcript toolbar in groups and keeps Ask with its actions at the right edge", async ({
  page,
  request,
}) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/sample.webm", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.webm` },
  });
  const media: { id: string } = await uploaded.json();
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({ json: completedJob(media.id, "Anna presents the numbers.") }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/media/${media.id}`);
  await expect(page.getByText("Parakeet Ultra · edited")).toBeVisible();
  const top = async (name: string) => {
    const found = await page.getByRole("button", { name, exact: true }).boundingBox();
    if (!found) throw new Error(`${name} has no box.`);
    return found.y;
  };
  await expect(async () => {
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(await top("Find and replace")).toBe(await top("History"));
    const ask = await top("Ask");
    expect(await top("Copy transcript")).toBe(ask);
    expect(await top("Export transcript")).toBe(ask);
    const exportIcon = await page
      .getByRole("button", { name: "Export transcript" })
      .locator("svg")
      .boundingBox();
    expect((exportIcon?.x ?? 0) + (exportIcon?.width ?? 0)).toBe(
      (heading?.x ?? 0) + (heading?.width ?? 0),
    );
  }).toPass();
  await expect.poll(() => noHorizontalScroll(page)).toBe(true);
});

test("moves the recording only as far as the open panel needs", async ({ page, request }) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/sample.webm", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.webm` },
  });
  const media: { id: string } = await uploaded.json();
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [] }));
  const title = page.getByRole("heading", { level: 1 });
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  const box = async (locator: typeof title) => {
    const found = await locator.boundingBox();
    if (!found) throw new Error("The element has no box.");
    return found;
  };

  await page.setViewportSize({ width: 1830, height: 900 });
  await page.goto(`/media/${media.id}`);
  const closedLeft = (await box(title)).x;
  await page.keyboard.press("/");
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await box(title)).x).toBe(closedLeft);

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect
    .poll(async () => {
      const heading = await box(title);
      return (await box(panel)).x - (heading.x + heading.width);
    })
    .toBe(36);
});

test("blocks questions about a transcript without words", async ({ page, request }) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.wav` },
  });
  const media: { id: string } = await uploaded.json();
  let job: TranscriptionJob = {
    ...completedJob(media.id, "Unused."),
    transcript: { language: null, words: [] },
    revision: 0,
  };
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({ json: job }),
  );
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  await page.goto(`/media/${media.id}`);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    panel.getByPlaceholder("No speech was detected, so there is nothing to ask about"),
  ).toBeDisabled();

  job = { ...job, revision: 1 };
  await page.reload();
  await expect(
    panel.getByPlaceholder("Restore a version from History to ask about this recording"),
  ).toBeDisabled();
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

test("sends a queued question once and returns it to the field when sending fails", async ({
  page,
}) => {
  const chatId = randomUUID();
  const question = userMessage("Who presents?");
  let detail: ChatDetail = {
    chat: summaryOf(chatId, null, "Who presents?"),
    messages: [question, answerMessage("answering", [])],
    hiddenBeforeSeq: 0,
  };
  let sends = 0;
  await connectedModel(page);
  await page.route("**/api/media", (route) =>
    route.fulfill({ json: { items: [], transcribing: false } satisfies LibraryList }),
  );
  await page.route("**/api/ask/chats", (route) => route.fulfill({ json: [detail.chat] }));
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/ask/chats/${chatId}/live`, (route) =>
    route.fulfill({ headers: { "content-type": "text/event-stream" }, body: liveBody("Anna") }),
  );
  await page.route(`**/api/ask/chats/${chatId}/messages`, (route) => {
    sends += 1;
    return route.fulfill({ status: 503, json: { error: "Movo isn't reachable." } });
  });

  await page.goto(`/ask?chat=${chatId}`);
  const composer = page.getByRole("textbox", { name: "Ask across your library…" });
  await composer.fill("And then?");
  await composer.press("Enter");
  await expect(page.getByText("“And then?” is sent when this answer ends.")).toBeVisible();
  detail = { ...detail, messages: [question, answerMessage("done", [])] };
  await expect(page.getByText("Movo isn't reachable.")).toBeVisible();
  await expect(composer).toHaveValue("And then?");
  await expect(page.getByText("“And then?” is sent when this answer ends.")).toHaveCount(0);
  expect(sends).toBe(1);
});

test("holds a queued question until the proposed change is decided", async ({ page, request }) => {
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
  const change = (extra: Partial<ToolPart>) =>
    tool(
      "replace_in_transcript",
      { mediaId: media.id, revision: 3, find: "Anna", replacement: "Hanna" },
      extra,
    );
  let detail: ChatDetail = {
    chat: summary,
    messages: [question, answerMessage("answering", [])],
    hiddenBeforeSeq: 0,
  };
  const events: string[] = [];
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [summary] }));
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/ask/chats/${chatId}/live`, (route) =>
    route.fulfill({ headers: { "content-type": "text/event-stream" }, body: liveBody("Anna") }),
  );
  await page.route(`**/api/ask/chats/${chatId}/approval`, (route) => {
    events.push("decided");
    detail = {
      ...detail,
      messages: [question, answerMessage("done", [change({ resultCount: 1 })])],
    };
    return route.fulfill({ status: 202, json: detail });
  });
  await page.route(`**/api/ask/chats/${chatId}/messages`, (route) => {
    events.push(`sent ${route.request().postDataJSON().text}`);
    return route.fulfill({ status: 202, json: detail });
  });

  await page.goto(`/media/${media.id}`);
  await expect(page.getByRole("button", { name: /^Ask/u })).toBeVisible();
  await page.keyboard.press("/");
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  const composer = panel.getByRole("textbox", { name: "Ask about this recording…" });
  await composer.fill("And then?");
  await composer.press("Enter");
  await expect(panel.getByText("“And then?” is sent when this answer ends.")).toBeVisible();
  detail = {
    ...detail,
    messages: [
      question,
      answerMessage("waiting_approval", [
        change({ state: "waiting_approval", approvalId: "approval-1" }),
      ]),
    ],
  };
  await expect(panel.getByText("Change the transcript?")).toBeVisible();
  await expect(panel.getByText("“And then?” is sent when this answer ends.")).toBeVisible();
  expect(events).toEqual([]);
  await panel.getByRole("button", { name: "Change", exact: true }).click();
  await expect.poll(() => events).toEqual(["decided", "sent And then?"]);
});

test("returns a queued question with its passage to the field when the panel switches to a new chat", async ({
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
  const detail: ChatDetail = {
    chat: summary,
    messages: [userMessage("Who presents?"), answerMessage("answering", [])],
    hiddenBeforeSeq: 0,
  };
  const requests: string[] = [];
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [summary] }));
  await page.route("**/api/ask/chats", (route) => {
    requests.push("created a chat");
    return route.abort();
  });
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/ask/chats/${chatId}/live`, (route) =>
    route.fulfill({ headers: { "content-type": "text/event-stream" }, body: liveBody("Anna") }),
  );
  await page.route(`**/api/ask/chats/${chatId}/messages`, (route) => {
    requests.push("sent");
    return route.abort();
  });

  await page.goto(`/media/${media.id}`);
  await expect(page.getByRole("button", { name: /^Ask/u })).toBeVisible();
  await page
    .getByRole("list", { name: "Timestamped passages" })
    .getByText("presents", { exact: false })
    .first()
    .click({ clickCount: 3 });
  await page
    .getByRole("toolbar", { name: "Selected text" })
    .getByRole("button", { name: "Ask about this" })
    .click();
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  const composer = panel.getByRole("textbox", { name: "Ask about this recording…" });
  const removePassage = panel.getByRole("button", { name: "Remove the passage" });
  await expect(removePassage).toBeVisible();
  await composer.fill("And then?");
  await composer.press("Enter");
  await expect(panel.getByText("“And then?” is sent when this answer ends.")).toBeVisible();
  await expect(removePassage).toHaveCount(0);
  await panel.getByRole("button", { name: "New chat" }).click();
  await expect(composer).toHaveValue("And then?");
  await expect(removePassage).toBeVisible();
  await expect(panel.getByText("“And then?” is sent when this answer ends.")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("returns a queued question once when its send fails after the panel switched chats", async ({
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
  let detail: ChatDetail = {
    chat: summary,
    messages: [question, answerMessage("answering", [])],
    hiddenBeforeSeq: 0,
  };
  const held: Route[] = [];
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [summary] }));
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/ask/chats/${chatId}/live`, (route) =>
    route.fulfill({ headers: { "content-type": "text/event-stream" }, body: liveBody("Anna") }),
  );
  await page.route(`**/api/ask/chats/${chatId}/messages`, (route) => {
    held.push(route);
  });

  await page.goto(`/media/${media.id}`);
  await expect(page.getByRole("button", { name: /^Ask/u })).toBeVisible();
  await page.keyboard.press("/");
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  const composer = panel.getByRole("textbox", { name: "Ask about this recording…" });
  await composer.fill("And then?");
  await composer.press("Enter");
  detail = { ...detail, messages: [question, answerMessage("done", [])] };
  await expect.poll(() => held.length).toBe(1);
  await panel.getByRole("button", { name: "New chat" }).click();
  await held[0]?.fulfill({ status: 503, json: { error: "Movo isn't reachable." } });
  await expect(panel.getByText("Movo isn't reachable.")).toBeVisible();
  await expect(composer).toHaveValue("And then?");
  expect(held).toHaveLength(1);
});

const passageStart = (index: number) => index * 4000;

function silentWav(seconds: number) {
  const rate = 8000;
  const samples = rate * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 0x80)]);
}

test("moves the open recording to each chosen moment, again on a repeated choice and while finding", async ({
  page,
  request,
}) => {
  const uploaded = await request.post("/api/media", {
    data: silentWav(300),
    headers: { "x-file-name": `${randomUUID()}.wav` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  const cited = passageStart(50);
  const earlier = passageStart(20);
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({
      json: {
        ...completedJob(media.id, ""),
        transcript: {
          language: "en",
          words: Array.from({ length: 60 }, (_, index) =>
            timedWords(
              passageStart(index),
              passageStart(index) + 2000,
              `Passage ${index} says something worth hearing.`,
            ),
          ).flat(),
        },
      },
    }),
  );
  const chatId = randomUUID();
  const detail: ChatDetail = {
    chat: summaryOf(chatId, media.id, "Where is it?"),
    messages: [
      userMessage("Where is it?"),
      answerMessage(
        "done",
        [{ type: "text", text: `It is said here [${cited}] and first here [${earlier}].` }],
        [
          { startMs: cited, mediaId: media.id },
          { startMs: earlier, mediaId: media.id },
        ],
      ),
    ],
    hiddenBeforeSeq: 0,
  };
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) => route.fulfill({ json: [detail.chat] }));
  await page.route(`**/api/ask/chats/${chatId}`, (route) => route.fulfill({ json: detail }));

  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`/media/${media.id}`);
  await expect(page.getByRole("button", { name: /^Ask/u })).toBeVisible();
  const player = page.locator("audio");
  await player.evaluate((element) => {
    element.dataset.probe = "kept";
  });
  await page.keyboard.press("/");
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  const passage = (startMs: number) => page.locator(`li[data-start-ms="${startMs}"]`);
  const playerSeconds = () => player.evaluate((element: HTMLMediaElement) => element.currentTime);

  await panel.getByRole("link", { name: "3:20" }).click();
  await expect(page).toHaveURL(new RegExp(`startMs=${cited}`, "u"));
  await expect(passage(cited)).toBeInViewport();
  await expect.poll(playerSeconds).toBeCloseTo(cited / 1000, 0);

  let lastScroll = -1;
  await expect
    .poll(
      async () => {
        const scroll = await page.evaluate(() => scrollY);
        const settled = scroll === lastScroll;
        lastScroll = scroll;
        return settled;
      },
      { intervals: [150] },
    )
    .toBe(true);
  await page.mouse.move(640, 400);
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, -500);
  await expect(passage(cited)).not.toBeInViewport();
  const entries = await page.evaluate(() => history.length);
  await panel.getByRole("link", { name: "3:20" }).click();
  await expect(passage(cited)).toBeInViewport();
  expect(await page.evaluate(() => history.length)).toBe(entries);

  await panel.getByRole("link", { name: "1:20" }).click();
  await expect(page).toHaveURL(new RegExp(`startMs=${earlier}`, "u"));
  await expect(passage(earlier)).toBeInViewport();
  await expect.poll(playerSeconds).toBeCloseTo(earlier / 1000, 0);
  expect(await player.evaluate((element) => element.dataset.probe)).toBe("kept");

  await page.getByRole("button", { name: "Find and replace", exact: true }).click();
  const form = page.getByRole("form", { name: "Find and replace" });
  await page.getByLabel("Find", { exact: true }).fill("worth");
  await panel.getByRole("link", { name: "3:20" }).click();
  await expect(page).toHaveURL(new RegExp(`startMs=${cited}`, "u"));
  await expect(passage(cited)).toBeInViewport();
  await expect(form).toBeInViewport();
  await expect(page.getByLabel("Find", { exact: true })).toHaveValue("worth");
});

test("opens an earlier chat about the recording from the panel's history", async ({
  page,
  request,
}) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/sample.webm", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.webm` },
  });
  const media: { id: string } = await uploaded.json();
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({ json: completedJob(media.id, "Anna presents the numbers.") }),
  );
  const chat = (title: string, answer: string): ChatDetail => ({
    chat: summaryOf(randomUUID(), media.id, title),
    messages: [userMessage(title), answerMessage("done", [{ type: "text", text: answer }])],
    hiddenBeforeSeq: 0,
  });
  const latest = chat("Who presents?", "Anna presents.");
  const earlier = chat("What is shown?", "The numbers are shown.");
  await connectedModel(page);
  await page.route("**/api/ask/chats?*", (route) =>
    route.fulfill({ json: [latest.chat, earlier.chat] }),
  );
  for (const detail of [latest, earlier])
    await page.route(`**/api/ask/chats/${detail.chat.id}`, (route) =>
      route.fulfill({ json: detail }),
    );

  await page.goto(`/media/${media.id}`);
  await expect(page.getByRole("button", { name: /^Ask/u })).toBeVisible();
  await page.keyboard.press("/");
  const panel = page.getByRole("complementary", { name: "Ask about this recording" });
  await expect(panel.getByText("Anna presents.")).toBeVisible();
  await panel.getByRole("button", { name: "Earlier chats" }).click();
  await expect(page.getByRole("group").getByText("Earlier chats")).toBeVisible();
  await page.getByRole("menuitem", { name: "What is shown?" }).click();
  await expect(panel.getByText("The numbers are shown.")).toBeVisible();
  await expect(panel.getByText("Anna presents.")).toHaveCount(0);
});

test("keeps long recording titles inside the Choose recordings dialog", async ({ page }) => {
  const titles = [
    "Short",
    "weekend z życia programisty - software factory, jesień i nowe projekty, które zaczynam",
    "Bardzodługitytułbezspacjiktórysięniełamieanizawijawcalenawetwąskimoknie",
  ];
  const library: LibraryList = {
    items: titles.map((title) => ({
      id: randomUUID(),
      title,
      originalName: "recording.wav",
      kind: "audio",
      contentType: "audio/wav",
      byteSize: 1000,
      durationSeconds: 2,
      importedAt: Date.now(),
      sourceUrl: null,
      fileRemovedAt: null,
      transcription: "done",
    })),
    transcribing: false,
  };
  await connectedModel(page);
  await page.route("**/api/ask/chats", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/media*", (route) => route.fulfill({ json: library }));

  for (const width of [900, 360]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/ask");
    await page.getByRole("button", { name: "Scope: All recordings" }).click();
    await page.getByRole("menuitem", { name: "Choose recordings…" }).click();
    const dialog = page.getByRole("dialog");
    const boxes = dialog.getByRole("checkbox");
    await expect(boxes).toHaveCount(titles.length);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const placed = await boxes.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return `${box.left}:${box.width}`;
      }),
    );
    expect(new Set(placed).size).toBe(1);
  }
});

test("connects a detected local server with the model chosen in its card", async ({ page }) => {
  const server: AiConnection = {
    id: randomUUID(),
    kind: "server",
    baseUrl: "http://127.0.0.1:8080",
    reach: "this-computer",
    keyHint: null,
    createdAt: Date.now(),
  };
  const served: AiModel[] = [
    { id: "gemma-small", name: "gemma-small", contextTokens: 131_072, tools: "yes" },
    { id: "gemma-large", name: "gemma-large", contextTokens: 131_072, tools: "yes" },
  ];
  let connected = false;
  let saved: ModelChoice | null = null;
  await page.route("**/api/ask/local", (route) =>
    route.fulfill({
      json: connected
        ? []
        : [
            {
              name: "llama-server",
              baseUrl: server.baseUrl,
              modelIds: served.map((model) => model.id),
            },
          ],
    }),
  );
  await page.route("**/api/ask/connections", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: connected ? [server] : [] });
    connected = true;
    return route.fulfill({ status: 201, json: server });
  });
  await page.route(`**/api/ask/connections/${server.id}/models`, (route) =>
    route.fulfill({ json: served }),
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
  const card = page.getByRole("region", { name: "llama-server on this computer" });
  await card.getByRole("button", { name: "Model: gemma-small" }).click();
  await page.getByRole("menuitemradio", { name: "gemma-large" }).click();
  await card.getByRole("button", { name: "Use it" }).click();
  await expect.poll(() => saved?.modelId).toBe("gemma-large");
  await expect(page.getByRole("textbox", { name: "Ask across your library…" })).toBeVisible();
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
  const heading = await page
    .getByRole("heading", { name: "Who presents the numbers?", level: 1 })
    .boundingBox();
  const bubble = await page
    .getByText("Who presents the numbers?", { exact: true })
    .last()
    .boundingBox();
  expect((bubble?.y ?? 0) - ((heading?.y ?? 0) + (heading?.height ?? 0))).toBeLessThan(48);
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
  await expect.poll(() => noHorizontalScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("link", { name: /Who presents the numbers\?/u }).click();
  const arrow = await page
    .getByRole("list", { name: "Sources" })
    .getByRole("listitem")
    .first()
    .locator("svg")
    .boundingBox();
  await page.mouse.click((arrow?.x ?? 0) + (arrow?.width ?? 0) / 2, (arrow?.y ?? 0) + 4);
  await expect(page).toHaveURL(new RegExp(`/media/${mediaId}$`, "u"));
});
