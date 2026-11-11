import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
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
    status: "completed",
    phase: "finished",
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
  await page.route(`**/api/media/${media.id}/transcription`, async (route) => {
    expect(route.request().method()).toBe("GET");
    await transcriptReady;
    return route.fulfill({ json: job });
  });
  await page.goto(`/media/${media.id}${startMs === undefined ? "" : `?startMs=${startMs}`}`);
  const video = page.locator("video");
  const passages = page.getByRole("list", { name: "Timestamped passages" }).getByRole("listitem");
  return {
    player: page.getByRole("region", { name: "Video player", exact: true }),
    video,
    passages,
    backToCurrent: page.getByRole("button", { name: /^Back to current/u }),
    seek: (seconds: number) =>
      video.evaluate((element: HTMLMediaElement, position) => {
        element.currentTime = position;
      }, seconds),
  };
}

test("keeps the video pinned, follows the spoken passage and pauses when scrolled by hand", async ({
  page,
  request,
}) => {
  const { player, video, passages, backToCurrent, seek } = await openTranscribedVideo(
    page,
    request,
  );
  await expect(passages).toHaveCount(passageCount);
  const scrollPosition = () => page.evaluate(() => window.scrollY);
  const gapBelowPlayer = async (index: number) => {
    const playerBounds = await player.boundingBox();
    const passageBounds = await passages.nth(index).boundingBox();
    if (!playerBounds || !passageBounds) throw new Error("Expected the player and passage.");
    return passageBounds.y - (playerBounds.y + playerBounds.height);
  };
  await expect(backToCurrent).toHaveCount(0);

  await seek(1.4);
  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await expect.poll(() => gapBelowPlayer(14)).toBeCloseTo(56, -1);
  await expect.poll(async () => (await player.boundingBox())?.y).toBeCloseTo(20, 0);
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
  await page.getByRole("button", { name: "Find and replace", exact: true }).click();
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

test("keeps the find form pinned below the video while it reveals a match further down", async ({
  page,
  request,
}) => {
  const { player, passages } = await openTranscribedVideo(page, request);
  await expect(passages).toHaveCount(passageCount);
  await page.getByRole("button", { name: "Find and replace", exact: true }).click();
  const form = page.getByRole("form", { name: "Find and replace" });

  await page.getByLabel("Find", { exact: true }).fill("20");
  await expect(form.getByText("1 of 1")).toBeVisible();
  const match = passages.nth(passageCount - 1).locator("mark");
  await expect(match).toBeInViewport();
  await expect(form).toBeInViewport();
  await expect(async () => {
    const playerBounds = await player.boundingBox();
    const formBounds = await form.boundingBox();
    const matchBounds = await match.boundingBox();
    if (!playerBounds || !formBounds || !matchBounds) throw new Error("Expected boxes.");
    expect(formBounds.y).toBeGreaterThanOrEqual(playerBounds.y + playerBounds.height);
    expect(matchBounds.y).toBeGreaterThanOrEqual(formBounds.y + formBounds.height);
  }).toPass();

  await page.getByLabel("Find", { exact: true }).fill("Step");
  await expect(form.getByText(`1 of ${passageCount}`)).toBeVisible();
  await form.getByRole("button", { name: "Previous match" }).click();
  await expect(form.getByText(`${passageCount} of ${passageCount}`)).toBeVisible();
  await form.getByRole("button", { name: "Next match" }).click();
  await expect(form.getByText(`1 of ${passageCount}`)).toBeVisible();
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
  const { player, passages, backToCurrent } = await openTranscribedVideo(page, request, {
    startMs: 1400,
  });
  await expect(passages).toHaveCount(passageCount);
  await expect(passages.nth(14)).toHaveAttribute("aria-current", "time");
  await expect(passages.nth(14)).toBeInViewport();
  const revealedPosition = await page.evaluate(() => window.scrollY);
  await expect.poll(async () => (await player.boundingBox())?.y).toBeCloseTo(20, 0);
  const playerBounds = await player.boundingBox();
  const passageBounds = await passages.nth(14).boundingBox();
  if (!playerBounds || !passageBounds) throw new Error("Expected the player and passage.");
  expect(passageBounds.y - (playerBounds.y + playerBounds.height)).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(revealedPosition);
  await expect(backToCurrent).toHaveCount(0);
});
