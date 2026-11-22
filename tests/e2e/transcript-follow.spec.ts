import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { maxSearchLength } from "../../src/shared/contracts/library.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../helpers/timed-words.ts";

const passageCount = 20;
const passageStartMs = (index: number) => 50 + index * 95;

function heldTranscript() {
  const held: { release?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    held.release = resolve;
  });
  return { promise, release: () => held.release?.() };
}

async function openTranscribedVideo(
  page: Page,
  request: APIRequestContext,
  {
    transcriptReady = Promise.resolve(),
    startMs,
  }: { transcriptReady?: Promise<void>; startMs?: number } = {},
) {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/sample.webm", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.webm` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  const job: TranscriptionJob = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    speakerModelId: null,
    status: "completed",
    phase: "finished",
    phaseProgress: null,
    transcript: {
      language: "en",
      words: Array.from({ length: passageCount }, (_, index) =>
        timedWords(
          passageStartMs(index),
          passageStartMs(index) + 90,
          `Step ${index + 1} of the tour explains one more part of the library.`,
        ),
      ).flat(),
    },
    revision: 0,
    resultRevision: 0,
    device: { backend: "cpu", name: "Test CPU" },
    error: null,
    cleanupError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let served = job;
  await page.route(`**/api/media/${media.id}/transcription`, async (route) => {
    expect(route.request().method()).toBe("GET");
    await transcriptReady;
    return route.fulfill({ json: served });
  });
  await page.goto(`/media/${media.id}${startMs === undefined ? "" : `?startMs=${startMs}`}`);
  const video = page.locator("video");
  const passages = page.getByRole("list", { name: "Timestamped passages" }).getByRole("listitem");
  return {
    player: page.getByRole("region", { name: "Video player", exact: true }),
    toolbar: page.getByRole("toolbar", { name: "Transcript" }),
    header: page.getByRole("banner"),
    video,
    passages,
    backToCurrent: page.getByRole("button", { name: /^Back to current/u }),
    seek: (seconds: number) =>
      video.evaluate((element: HTMLMediaElement, position) => {
        element.currentTime = position;
      }, seconds),
    serveSpeakerNames: async (speakers: { id: number; name: string }[]) => {
      if (!served.transcript) throw new Error("Expected a transcript.");
      served = {
        ...served,
        transcript: {
          ...served.transcript,
          words: served.transcript.words.map((word) => ({ ...word, speaker: 1 })),
          speakers,
        },
      };
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
      );
    },
  };
}

test("keeps the video beside the transcript, follows the spoken passage and pauses when scrolled by hand", async ({
  page,
  request,
}) => {
  const { player, toolbar, header, video, passages, backToCurrent, seek } =
    await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  const scrollPosition = () => page.evaluate(() => window.scrollY);
  const top = async (locator: typeof player) => (await locator.boundingBox())?.y ?? Number.NaN;
  const gapBelowToolbar = async (index: number) => {
    const toolbarBounds = await toolbar.boundingBox();
    const passageBounds = await passages.nth(index).boundingBox();
    if (!toolbarBounds || !passageBounds) throw new Error("Expected the toolbar and passage.");
    return passageBounds.y - (toolbarBounds.y + toolbarBounds.height);
  };
  await expect(backToCurrent).toHaveCount(0);
  const playerTop = await top(player);
  const toolbarTop = await top(toolbar);

  await seek(0.76);
  await expect(passages.nth(7)).toHaveAttribute("aria-current", "time");
  await expect.poll(() => gapBelowToolbar(7)).toBeCloseTo(72, 0);
  expect(await scrollPosition()).toBeGreaterThan(0);
  expect(await top(player)).toBe(playerTop);
  expect(await top(toolbar)).toBe(toolbarTop);
  expect(await top(header)).toBe(0);
  const followedPosition = await scrollPosition();

  await page.mouse.move(640, 600);
  await page.mouse.wheel(0, -400);
  await expect(backToCurrent).toBeVisible();
  await video.evaluate(async (element: HTMLMediaElement) => {
    element.muted = true;
    await element.play();
  });
  await expect(passages.nth(passageCount - 1)).toHaveAttribute("aria-current", "time");
  expect(await scrollPosition()).toBeLessThan(followedPosition);
  await expect(passages.nth(passageCount - 1)).not.toBeInViewport();

  await backToCurrent.click();
  await expect(backToCurrent).toHaveCount(0);
  await expect(passages.nth(passageCount - 1)).toBeInViewport();

  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect(backToCurrent).toBeVisible();
});

test("keeps an open, empty find form in place and offers the way back after closing it", async ({
  page,
  request,
}) => {
  const { passages, backToCurrent, seek } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByLabel("Find", { exact: true })).toBeFocused();

  await seek(1.4);
  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await expect(backToCurrent).toHaveCount(0);
  await page
    .getByRole("form", { name: "Find and replace" })
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await expect(backToCurrent).toBeVisible();
  await expect(passages.nth(14)).not.toBeInViewport();
  await backToCurrent.click();
  await expect(passages.nth(14)).toBeInViewport();
});

test("keeps the find form pinned above the transcript while it reveals a match further down", async ({
  page,
  request,
}) => {
  const { header, passages } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  const form = page.getByRole("form", { name: "Find and replace" });

  await page.getByLabel("Find", { exact: true }).fill("20");
  await expect(form.getByText("1 of 1")).toBeVisible();
  const match = passages.nth(passageCount - 1).locator("mark");
  await expect(match).toBeInViewport();
  await expect(form).toBeInViewport();
  await expect(async () => {
    const headerBounds = await header.boundingBox();
    const formBounds = await form.boundingBox();
    const matchBounds = await match.boundingBox();
    if (!headerBounds || !formBounds || !matchBounds) throw new Error("Expected boxes.");
    expect(formBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
    expect(matchBounds.y).toBeGreaterThanOrEqual(formBounds.y + formBounds.height);
  }).toPass();

  await page.getByLabel("Find", { exact: true }).fill("Step");
  await expect(form.getByText(`1 of ${passageCount}`)).toBeVisible();
  await form.getByRole("button", { name: "Previous match" }).click();
  await expect(form.getByText(`${passageCount} of ${passageCount}`)).toBeVisible();
  await form.getByRole("button", { name: "Next match" }).click();
  await expect(form.getByText(`1 of ${passageCount}`)).toBeVisible();
});

test("reveals the current search match below the pinned search when the search or match changes", async ({
  page,
  request,
}) => {
  const { header, passages, seek, serveSpeakerNames } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  await seek(0.06);
  await expect(passages.nth(0).locator("mark")).toHaveCount(1);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("search", { name: "Search this transcript" });
  const field = search.getByRole("searchbox", { name: "Search this transcript" });
  await expect(passages.nth(0).locator("mark")).toHaveCount(0);

  await field.fill("step 20");
  await expect(search.getByText("1 of 1")).toBeVisible();
  const match = passages.nth(passageCount - 1);
  const expectBelowSearch = () =>
    expect(async () => {
      const headerBounds = await header.boundingBox();
      const searchBounds = await search.boundingBox();
      const matchBounds = await match.boundingBox();
      if (!headerBounds || !searchBounds || !matchBounds) throw new Error("Expected boxes.");
      expect(searchBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
      expect(matchBounds.y).toBeGreaterThanOrEqual(searchBounds.y + searchBounds.height);
      expect(matchBounds.y + matchBounds.height).toBeLessThanOrEqual(
        page.viewportSize()?.height ?? 0,
      );
    }).toPass();
  await expectBelowSearch();

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(match).not.toBeInViewport();
  await field.pressSequentially(" of");
  await expect(search.getByText("1 of 1")).toBeVisible();
  await expectBelowSearch();
  await expect(page).toHaveURL(/\?q=step(\+|%20)20(\+|%20)of$/u);
  await expectBelowSearch();

  await page.evaluate(() => window.scrollTo(0, 0));
  await serveSpeakerNames([{ id: 1, name: "Neil" }]);
  await expect(page.getByText("Neil", { exact: true })).toBeVisible();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(match).not.toBeInViewport();
  await search.getByRole("button", { name: "Next match" }).click();
  await expectBelowSearch();
});

test("offers the way back after editing elsewhere and keeps following after editing the spoken passage", async ({
  page,
  request,
}) => {
  const { passages, backToCurrent, seek } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  const passageText = page.getByLabel("Passage text", { exact: true });
  await passages
    .nth(0)
    .getByRole("button", { name: /^Edit passage/u })
    .click();
  await expect(passageText).toBeFocused();

  await seek(1.4);
  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await passageText.press("Escape");
  await expect(backToCurrent).toBeVisible();
  await expect(passages.nth(14)).not.toBeInViewport();

  await backToCurrent.click();
  await expect(passages.nth(14)).toBeInViewport();
  await passages
    .nth(14)
    .getByRole("button", { name: /^Edit passage/u })
    .click();
  await expect(passageText).toBeFocused();
  await passageText.press("Escape");
  await expect(passages.nth(14)).toBeInViewport();
  await expect(backToCurrent).toHaveCount(0);
});

test("brings the spoken passage into view when the transcript arrives after playback moved on", async ({
  page,
  request,
}) => {
  const transcript = heldTranscript();
  const { player, passages, backToCurrent, seek } = await openTranscribedVideo(page, request, {
    transcriptReady: transcript.promise,
  });
  await expect(player).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  await seek(1.4);
  await expect(player).toContainText("0:01");
  transcript.release();

  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await expect(passages.nth(14)).toBeInViewport();
  await expect(backToCurrent).toHaveCount(0);
});

test("keeps a passage opened from search where it was revealed", async ({ page, request }) => {
  const { player, toolbar, passages, backToCurrent } = await openTranscribedVideo(page, request, {
    startMs: 1400,
  });
  await expect(passages).toHaveCount(passageCount);
  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await expect(passages.nth(14)).toBeInViewport();
  await expect(player).toBeInViewport();
  const revealedPosition = await page.evaluate(() => window.scrollY);
  const toolbarBounds = await toolbar.boundingBox();
  const passageBounds = await passages.nth(14).boundingBox();
  if (!toolbarBounds || !passageBounds) throw new Error("Expected the toolbar and passage.");
  expect(passageBounds.y - (toolbarBounds.y + toolbarBounds.height)).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(revealedPosition);
  await expect(backToCurrent).toHaveCount(0);
});

test("folds the video into a compact player on a narrow screen and brings it back", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const { player, passages, backToCurrent, seek } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  const compact = page.getByRole("region", { name: "Player", exact: true });
  await expect(compact).toHaveCount(0);

  await seek(1.4);
  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await expect(passages.nth(14)).toBeInViewport();
  await expect(player).not.toBeInViewport();
  await expect(compact).toBeVisible();
  await expect(compact).toContainText("0:01 of 0:02");

  await compact.getByRole("button", { name: "Show the video" }).press("Enter");
  await expect(player).toBeInViewport({ ratio: 1 });
  await expect(player).toBeFocused();
  await expect(compact).toHaveCount(0);
  await expect(backToCurrent).toBeVisible();
  await backToCurrent.click();
  await expect(passages.nth(14)).toBeInViewport();
  await expect(compact).toBeVisible();
});

test("opens search and replace from the keyboard and returns focus after closing", async ({
  page,
  request,
}) => {
  const { passages } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  const searchButton = page.getByRole("button", { name: "Search", exact: true });
  await expect(searchButton).toHaveAttribute("aria-keyshortcuts", "Control+F");
  await expect(searchButton).toContainText("Ctrl+F");

  await page.keyboard.press("Control+F");
  const search = page.getByRole("search", { name: "Search this transcript" });
  const field = search.getByRole("searchbox", { name: "Search this transcript" });
  await expect(field).toBeFocused();
  await field.fill("step 20");
  await expect(search.getByText("1 of 1")).toBeVisible();

  await page.keyboard.press("Control+H");
  const form = page.getByRole("form", { name: "Find and replace" });
  const find = form.getByLabel("Find", { exact: true });
  await expect(find).toHaveValue("step 20");
  await expect(find).toBeFocused();
  await expect(page).not.toHaveURL(/q=/u);

  const modes = form.getByRole("group", { name: "Search or replace" });
  await expect(modes.getByRole("button", { name: "Replace", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await form.getByLabel("Replace with", { exact: true }).press("Control+F");
  await expect(field).toHaveValue("step 20");
  await expect(field).toBeFocused();

  await search
    .getByRole("group", { name: "Search or replace" })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expect(find).toHaveValue("step 20");
  await find.press("Control+F");
  await expect(field).toBeFocused();
  await field.press("Control+H");
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(searchButton).toBeFocused();

  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await find.fill("a".repeat(maxSearchLength + 39));
  await modes.getByRole("button", { name: "Search", exact: true }).click();
  await expect(field).toHaveValue("a".repeat(maxSearchLength));
  await expect(page).toHaveURL(/q=a+/u);
  await page.reload();
  await expect(field).toHaveValue("a".repeat(maxSearchLength));
  await field.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(searchButton).toBeFocused();
  await expect(page).not.toHaveURL(/q=/u);
});
