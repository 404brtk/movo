import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import type { ModelChoice } from "../../src/shared/contracts/ask.ts";
import type {
  Chapter,
  RecordingOverview,
  RecordingSummary,
} from "../../src/shared/contracts/overview.ts";
import type {
  TranscriptionJob,
  TranscriptWord,
} from "../../src/shared/contracts/transcriptions.ts";
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

const meetingWords = [
  ...timedWords(0, 900, "Welcome to the planning meeting."),
  ...timedWords(1200, 1900, "The hiring budget grows next year."),
];
const spoken = (speaker: number, startMs: number, endMs: number, text: string) =>
  timedWords(startMs, endMs, text).map((word) => ({ ...word, speaker }));

async function openRecording(
  page: Page,
  api: APIRequestContext,
  initial: RecordingOverview,
  words: TranscriptWord[] = meetingWords,
) {
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
      words,
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
  await expect(section.getByText("No summary yet.", { exact: true })).toBeVisible();
  await expect(
    section.getByRole("link", { name: "Model A, change the model in Settings" }),
  ).toBeVisible();
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

test("reveals a long summary and its key points in one height transition", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openRecording(page, request, {
    ...empty,
    summary: { ...summary, text: `${summary.text} `.repeat(5).trim() },
  });
  const section = page.getByRole("region", { name: "Summary" });
  const readMore = section.getByRole("button", { name: /Read more/u });
  await expect(readMore).toHaveAttribute("aria-expanded", "false");
  const motion = await readMore.evaluate(async (trigger) => {
    const id = trigger.getAttribute("aria-controls");
    const panel = id && document.getElementById(id);
    if (!panel) throw new Error("Missing summary panel");
    const height = () => panel.getBoundingClientRect().height;
    const move = async () => {
      const before = height();
      const transition = new Promise<CSSTransition>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Expected summary height to transition")),
          1500,
        );
        const onStart = (event: TransitionEvent) => {
          if (event.target !== panel || event.propertyName !== "height") return;
          const movement = panel.getAnimations().find((entry) => entry instanceof CSSTransition);
          if (movement instanceof CSSTransition) {
            clearTimeout(timer);
            panel.removeEventListener("transitionrun", onStart);
            movement.pause();
            resolve(movement);
          }
        };
        panel.addEventListener("transitionrun", onStart);
      });
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      const movement = await transition;
      movement.currentTime = 0;
      const start = height();
      movement.currentTime = 60;
      const intermediate = height();
      movement.finish();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { before, start, intermediate, after: height() };
    };
    return { open: await move(), close: await move() };
  });
  expect(motion.open.start).toBeCloseTo(motion.open.before);
  expect(motion.open.intermediate).toBeGreaterThan(motion.open.before);
  expect(motion.open.intermediate).toBeLessThan(motion.open.after);
  expect(motion.close.start).toBeCloseTo(motion.open.after);
  expect(motion.close.intermediate).toBeGreaterThan(motion.open.before);
  expect(motion.close.intermediate).toBeLessThan(motion.open.after);
  expect(motion.close.after).toBeCloseTo(motion.open.before);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = page.locator(`[id="${await readMore.getAttribute("aria-controls")}"]`);
  await readMore.click();
  await expect(section.getByRole("button", { name: "Show less" })).toBeVisible();
  expect(await panel.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(
    motion.open.after,
  );
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

test("keeps a chapter edit open until its save finishes before editing another", async ({
  page,
  request,
}) => {
  await openRecording(page, request, { ...empty, chapters, chaptersSource: "model" });
  const heldSaves: Route[] = [];
  await page.route(`**/chapters/${chapters[1]?.id}`, (route) => {
    heldSaves.push(route);
  });
  const list = page.getByRole("navigation", { name: "Chapters" });
  await list.getByRole("button", { name: "0:01 Hiring budget", exact: true }).focus();
  await page.keyboard.press("F2");
  const title = list.getByRole("textbox", { name: "Chapter title" });
  await title.fill("Budget and hiring");
  await title.press("Enter");
  await list.getByRole("button", { name: "0:00 Opening", exact: true }).focus();
  await page.keyboard.press("F2");
  await expect(title).toHaveValue("Budget and hiring");

  expect(heldSaves).toHaveLength(1);
  await Promise.all(heldSaves.map((route) => route.fallback()));
  await expect(
    list.getByRole("button", { name: "0:01 Budget and hiring", exact: true }),
  ).toBeVisible();
  await expect(title).toHaveCount(0);
  await list.getByRole("button", { name: "0:00 Opening", exact: true }).focus();
  await page.keyboard.press("F2");
  await expect(title).toHaveValue("Opening");
});

test("finishes a new chapter and an undone deletion that save at the same time", async ({
  page,
  request,
}) => {
  await openRecording(page, request, { ...empty, chapters, chaptersSource: "model" });
  const list = page.getByRole("navigation", { name: "Chapters" });
  await list.getByRole("button", { name: "0:01 Hiring budget", exact: true }).focus();
  await page.keyboard.press("Delete");
  await expect(list.getByRole("button", { name: "0:01 Hiring budget", exact: true })).toHaveCount(
    0,
  );
  const heldCreates: Route[] = [];
  await page.route("**/chapters", async (route) => {
    if (route.request().method() === "POST") heldCreates.push(route);
    else await route.fallback();
  });
  await list.getByRole("button", { name: "Chapter actions" }).click();
  await page.getByRole("menuitem", { name: "Add chapter at 0:00" }).click();
  const title = list.getByRole("textbox", { name: "Chapter title" });
  await title.fill("Wrap-up");
  await title.press("Enter");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => heldCreates.length).toBe(2);

  for (const route of heldCreates) await route.fallback();
  await expect(list.getByRole("button", { name: "0:00 Wrap-up", exact: true })).toBeVisible();
  await expect(list.getByRole("button", { name: "0:01 Hiring budget", exact: true })).toBeVisible();
  await expect(title).toHaveCount(0);
  await list.getByRole("button", { name: "0:00 Opening", exact: true }).focus();
  await page.keyboard.press("F2");
  await expect(title).toHaveValue("Opening");
});

test("offers Undo for every chapter deleted in quick succession", async ({ page, request }) => {
  await openRecording(page, request, { ...empty, chapters, chaptersSource: "model" });
  const heldDeletes: Route[] = [];
  await page.route("**/chapters/*", async (route) => {
    if (route.request().method() === "DELETE") heldDeletes.push(route);
    else await route.fallback();
  });
  const list = page.getByRole("navigation", { name: "Chapters" });
  await list.getByRole("button", { name: "0:00 Opening", exact: true }).focus();
  await page.keyboard.press("Delete");
  await expect(list.getByRole("button", { name: "0:01 Hiring budget", exact: true })).toBeFocused();
  await page.keyboard.press("Delete");
  await expect.poll(() => heldDeletes.length).toBe(2);

  for (const route of heldDeletes) await route.fallback();
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications.getByText("Deleted “Opening”", { exact: true })).toBeAttached();
  await expect(notifications.getByText("Deleted “Hiring budget”", { exact: true })).toBeVisible();
  await expect(
    notifications.getByRole("button", { name: "Undo", includeHidden: true }),
  ).toHaveCount(2);
});

test("places chapter headings beside their passages inside a folded speaker", async ({
  page,
  request,
}) => {
  await openRecording(
    page,
    request,
    {
      ...empty,
      chapters: [
        { id: randomUUID(), startMs: 0, title: "Opening" },
        { id: randomUUID(), startMs: 600, title: "Hiring budget" },
      ],
      chaptersSource: "model",
    },
    [
      ...spoken(1, 0, 500, "Welcome to the planning meeting."),
      ...spoken(1, 600, 1100, "The hiring budget grows next year."),
      ...spoken(2, 1200, 1700, "Thanks for joining."),
    ],
  );
  const transcript = page.getByRole("list", { name: "Timestamped passages" });
  await page.getByRole("button", { name: "Speakers", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Speaker 2" }).click();
  await page.keyboard.press("Escape");
  await expect(transcript.getByRole("listitem")).toHaveText([
    /Opening$/u,
    /Hiring budget$/u,
    /^Speaker 1 · 2 passages/u,
    /Thanks for joining\./u,
  ]);

  await transcript.getByRole("button", { name: /^Speaker 1 · 2 passages/u }).click();
  await expect(transcript.getByRole("listitem")).toHaveText([
    /Opening$/u,
    /^Hide Speaker 1/u,
    /Welcome to the planning meeting\./u,
    /Hiring budget$/u,
    /The hiring budget grows next year\./u,
    /Thanks for joining\./u,
  ]);
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
  const settings = section.getByRole("link", { name: "Model A, change the model in Settings" });
  const background = await settings.evaluate((link) => getComputedStyle(link).backgroundColor);
  await settings.hover();
  await expect(settings).not.toHaveCSS("background-color", background);
  await expect(settings).toHaveCSS("text-decoration-line", "none");
  await settings.click();
  await expect(page).toHaveURL(/\/settings#ask$/u);
  const ask = page.getByRole("region", { name: "Ask", exact: true });
  await expect(ask.getByText("New chats answer with", { exact: true })).toBeInViewport();
  expect(state.requests).toEqual([]);
});

test("asks to connect a model before writing", async ({ page, request }) => {
  await page.route("**/api/ask/default", (route) => route.fulfill({ json: null }));
  await openRecording(page, request, empty);
  const section = page.getByRole("region", { name: "Summary" });
  const connect = section.getByRole("link", { name: "Connect a model" });
  await expect(connect).toBeVisible();
  await expect(section.getByRole("button", { name: /Write summary/u })).toHaveCount(0);
  await connect.click();
  await expect(page).toHaveURL(/\/settings#ask$/u);
});
