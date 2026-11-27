import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { ModelChoice } from "../../src/shared/contracts/ask.ts";
import type {
  Chapter,
  RecordingOverview,
  RecordingSummary,
} from "../../src/shared/contracts/overview.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../helpers/timed-words.ts";

const choice: ModelChoice = {
  connectionId: randomUUID(),
  modelId: "model-a",
  modelName: "Model A",
  contextTokens: 200_000,
};
const summary: RecordingSummary = {
  text: "The team agrees to grow the hiring budget. Anna leads the planning and reports back in March.",
  keyPoints: [{ startMs: 1200, text: "The hiring budget grows next year" }],
  source: "model",
  modelName: "Model A",
  updatedAt: Date.now(),
};
const chapters: Chapter[] = [
  { id: randomUUID(), startMs: 0, title: "Opening" },
  { id: randomUUID(), startMs: 1100, title: "Hiring budget" },
];
const empty: RecordingOverview = {
  summary: null,
  stale: null,
  chapters: [],
  chaptersSource: null,
  writing: null,
  failure: null,
};

async function openRecording(page: Page, api: APIRequestContext, initial: RecordingOverview) {
  const uploaded = await api.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.wav` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  const job: TranscriptionJob = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    speakerModelId: null,
    resultSpeakerModelId: null,
    status: "completed",
    phase: "finished",
    phaseProgress: null,
    transcript: {
      language: "en",
      words: [
        ...timedWords(0, 900, "Welcome to the planning meeting."),
        ...timedWords(1200, 1900, "The hiring budget grows next year."),
      ],
    },
    revision: 0,
    resultRevision: 0,
    device: null,
    speakerDevice: null,
    resultDevice: null,
    resultSpeakerDevice: null,
    error: null,
    cleanupError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const state = {
    overview: initial,
    requests: [] as { method: string; path: string; body: unknown }[],
  };
  await page.route(`**/api/media/${media.id}/transcription`, (route) =>
    route.fulfill({ json: job }),
  );
  await page.route(
    (url) =>
      url.pathname.startsWith(`/api/media/${media.id}/`) &&
      /overview|summary|chapters/u.test(url.pathname),
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(`/api/media/${media.id}`, "");
      if (request.method() !== "GET")
        state.requests.push({ method: request.method(), path, body: request.postDataJSON() });
      if (path === "/overview/write") {
        state.overview = { ...state.overview, writing: { scope: "all", part: null, parts: null } };
        return route.fulfill({ status: 202, json: state.overview });
      }
      if (path === "/summary" && request.method() === "PUT") {
        const edit: { text: string; keyPoints: RecordingSummary["keyPoints"] } =
          request.postDataJSON();
        state.overview = {
          ...state.overview,
          summary: { ...summary, ...edit, source: "edited", modelName: null },
        };
      }
      if (path.startsWith("/chapters/") && request.method() === "PATCH") {
        const id = path.slice("/chapters/".length);
        const change: Partial<Chapter> = request.postDataJSON();
        state.overview = {
          ...state.overview,
          chapters: state.overview.chapters.map((chapter) =>
            chapter.id === id ? { ...chapter, ...change } : chapter,
          ),
        };
      }
      if (path.startsWith("/chapters/") && request.method() === "DELETE") {
        const id = path.slice("/chapters/".length);
        state.overview = {
          ...state.overview,
          chapters: state.overview.chapters.filter((chapter) => chapter.id !== id),
        };
      }
      if (path === "/chapters" && request.method() === "POST") {
        const created: Chapter = { id: randomUUID(), ...request.postDataJSON() };
        state.overview = {
          ...state.overview,
          chapters: [...state.overview.chapters, created].toSorted(
            (first, second) => first.startMs - second.startMs,
          ),
        };
        return route.fulfill({ status: 201, json: state.overview });
      }
      return route.fulfill({ json: state.overview });
    },
  );
  await page.goto(`/media/${media.id}`);
  return state;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/ask/default", (route) => route.fulfill({ json: choice }));
});

test("writes a summary on request and remembers whether it is expanded", async ({
  page,
  request,
}) => {
  const state = await openRecording(page, request, empty);
  const section = page.getByRole("region", { name: "Summary" });
  await expect(section).toHaveText(/^Summary\s*Write summary and chapters\s*Change model$/u);
  expect(state.requests).toEqual([]);
  await section.getByRole("button", { name: "Write summary and chapters" }).click();
  await expect(section.getByRole("status")).toHaveText("Writing the summary");
  expect(state.requests).toEqual([
    { method: "POST", path: "/overview/write", body: { scope: "all" } },
  ]);
  state.overview = { ...empty, summary, chapters, chaptersSource: "model" };
  await expect(section.getByText("The team agrees to grow the hiring budget.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Hiring budget" })).toBeVisible();
  const readMore = section.getByRole("button", { name: /Read more/u });
  const point = section.getByRole("button", {
    name: "Jump to 0:01, The hiring budget grows next year",
  });
  await expect(readMore).toHaveAttribute("aria-expanded", "false");
  await readMore.press("Shift+Tab");
  await expect(section.getByRole("button", { name: "Summary actions" })).toBeFocused();
  await readMore.press("Enter");
  await expect(point).toBeFocused();
  await expect(section.getByRole("button", { name: /Show less/u })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.reload();
  await expect(section.getByRole("button", { name: /Show less/u })).toBeVisible();
  await point.click();
  await expect(
    page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("button", { name: "0:01 Hiring budget", exact: true }),
  ).toHaveAttribute("aria-current", "true");
});

test("seeks from the chapter list, shows chapter names on the timeline and edits chapters in place", async ({
  page,
  request,
}) => {
  const state = await openRecording(page, request, {
    ...empty,
    summary,
    chapters,
    chaptersSource: "model",
  });
  const list = page.getByRole("navigation", { name: "Chapters" });
  await expect(list.getByRole("button", { name: "0:00 Opening", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await list.getByRole("button", { name: "0:01 Hiring budget", exact: true }).click();
  await expect(
    list.getByRole("button", { name: "0:01 Hiring budget", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute(
    "aria-valuetext",
    /chapter Hiring budget/u,
  );
  const segment = page.locator('[data-slot="slider-segment"]').first();
  const box = await segment.boundingBox();
  if (!box) throw new Error("The chapter segment is not visible.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText("Opening0:00", { exact: true })).toBeVisible();

  await list.getByRole("button", { name: "0:01 Hiring budget", exact: true }).focus();
  await page.keyboard.press("F2");
  const title = list.getByRole("textbox", { name: "Chapter title" });
  await title.fill("Budget and hiring");
  await title.press("Enter");
  await expect(
    list.getByRole("button", { name: "0:01 Budget and hiring", exact: true }),
  ).toBeVisible();
  expect(state.requests.at(-1)).toEqual({
    method: "PATCH",
    path: `/chapters/${chapters[1]?.id}`,
    body: { title: "Budget and hiring" },
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await list.getByRole("button", { name: "0:01 Budget and hiring", exact: true }).focus();
  await page.keyboard.press("Delete");
  await expect(
    list.getByRole("button", { name: "0:01 Budget and hiring", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    list.getByRole("button", { name: "0:01 Budget and hiring", exact: true }),
  ).toBeVisible();
  expect(state.requests.at(-1)).toEqual({
    method: "POST",
    path: "/chapters",
    body: { id: chapters[1]?.id, startMs: 1100, title: "Budget and hiring" },
  });
});

test("edits the summary and its key points by hand", async ({ page, request }) => {
  const state = await openRecording(page, request, { ...empty, summary });
  const section = page.getByRole("region", { name: "Summary" });
  await section.getByRole("heading", { name: "Summary" }).hover();
  await section.getByRole("button", { name: "Summary actions" }).click();
  await page.getByRole("menuitem", { name: "Edit summary" }).click();
  const text = section.getByRole("textbox", { name: "Summary" });
  await expect(text).toBeFocused();
  await text.fill("Budget grows. Anna leads.");
  await section.getByRole("textbox", { name: "Key point 1 time" }).fill("9:99");
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("alert")).toHaveText(
    "Enter each key point time like 1:05, inside the recording.",
  );
  await section.getByRole("textbox", { name: "Key point 1 time" }).fill("0:01");
  await text.press("Control+Enter");
  await expect(section.getByText("Budget grows.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Summary actions" })).toBeFocused();
  expect(state.requests.at(-1)).toEqual({
    method: "PUT",
    path: "/summary",
    body: {
      text: "Budget grows. Anna leads.",
      keyPoints: [{ startMs: 1200, text: "The hiring budget grows next year" }],
    },
  });
  await expect(section.getByText(/Edited by you/u)).toBeAttached();
});

test("opens the chapters from the player on a narrow screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecording(page, request, { ...empty, chapters, chaptersSource: "model" });
  await expect(
    page
      .getByRole("region", { name: "Summary" })
      .getByRole("button", { name: "Write summary", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  await page.getByRole("button", { name: "Chapter: Opening. Show chapters" }).click();
  const sheet = page.getByRole("dialog", { name: "Chapters" });
  await sheet.getByRole("button", { name: "0:01 Hiring budget", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Chapter: Hiring budget. Show chapters" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("adds the first chapter on a phone without a model", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/ask/default", (route) => route.fulfill({ json: null }));
  const state = await openRecording(page, request, empty);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Chapters…" }).click();
  const sheet = page.getByRole("dialog", { name: "Chapters" });
  await sheet.getByRole("button", { name: "Chapter actions" }).click();
  await page.getByRole("menuitem", { name: "Add chapter at 0:00" }).click();
  const title = sheet.getByRole("textbox", { name: "Chapter title" });
  await title.fill("Introductions");
  await title.press("Enter");
  await expect(
    sheet.getByRole("button", { name: "0:00 Introductions", exact: true }),
  ).toBeVisible();
  expect(state.requests).toEqual([
    { method: "POST", path: "/chapters", body: { startMs: 0, title: "Introductions" } },
  ]);
});

test("retries only the chapters when chapter generation fails", async ({ page, request }) => {
  const state = await openRecording(page, request, {
    ...empty,
    summary,
    chapters,
    chaptersSource: "manual",
    failure: { scope: "chapters", kind: "other", message: "The model stopped." },
  });
  const list = page.getByRole("navigation", { name: "Chapters" });
  await list.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "Write new chapters" }).click();
  await expect
    .poll(() => state.requests)
    .toEqual([{ method: "POST", path: "/overview/write", body: { scope: "chapters" } }]);
});

test("opens the default model settings from an empty summary", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openRecording(page, request, empty);
  const section = page.getByRole("region", { name: "Summary" });
  await section.getByRole("link", { name: "Change model" }).click();
  await expect(page).toHaveURL(/\/settings#ask$/u);
  const ask = page.getByRole("region", { name: "Ask", exact: true });
  await expect(ask.getByText("New chats answer with", { exact: true })).toBeInViewport();
  expect(state.requests).toEqual([]);
});

test("asks to connect a model before writing", async ({ page, request }) => {
  await page.route("**/api/ask/default", (route) => route.fulfill({ json: null }));
  await openRecording(page, request, empty);
  const section = page.getByRole("region", { name: "Summary" });
  await expect(section).toHaveText(/^Summary\s*Connect a model$/u);
  await section.getByRole("link", { name: "Connect a model" }).click();
  await expect(page).toHaveURL(/\/settings#ask$/u);
});
