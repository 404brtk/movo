import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";

test("transcribes explicitly, keeps working across navigation and seeks from saved passages", async ({
  page,
  request,
}) => {
  const title = `Transcription ${randomUUID()}`;
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": encodeURIComponent(`${title}.wav`) },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  let job: TranscriptionJob | null = null;
  let attempts = 0;
  await page.route(`**/api/media/${media.id}/transcription`, async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postData()).toBeNull();
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Download Parakeet Ultra from Models before transcribing a recording." },
        });
      job = {
        mediaId: media.id,
        modelId: "parakeet-ultra-q8",
        status: "running",
        phase: "transcribing",
        transcript: null,
        error: null,
        cleanupError: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return route.fulfill({ status: 202, json: job });
    }
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: job });
  });
  await page.goto(`/media/${media.id}`);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  await expect(panel.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Copy text", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: /^Download /u })).toHaveCount(0);
  expect(attempts).toBe(0);
  await panel.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Download Parakeet Ultra");
  await expect(panel.getByRole("link", { name: "Models", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Transcribing");
  await expect(panel.getByRole("link", { name: /^Download /u })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  job = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    status: "completed",
    phase: "finished",
    transcript: {
      language: "en",
      segments: [
        { startMs: 100, endMs: 800, text: "First saved passage." },
        { startMs: 1000, endMs: 1800, text: "Second saved passage." },
      ],
    },
    error: null,
    cleanupError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expect(panel.getByText("Second saved passage.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText("First saved passage.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Go to 0:01", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeCloseTo(1, 1);
  expect(attempts).toBe(2);
});

test("cancels, recovers after a rejected retry and shows an empty transcript with cleanup guidance", async ({
  page,
  request,
}) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.wav` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  let job: TranscriptionJob = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    status: "running",
    phase: "loading",
    transcript: null,
    error: null,
    cleanupError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let retries = 0;
  await page.route(`**/api/media/${media.id}/transcription`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: job });
  });
  await page.route(`**/api/media/${media.id}/transcription/cancel`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    job = { ...job, status: "cancelled", phase: "finished" };
    return route.fulfill({ json: job });
  });
  await page.route(`**/api/media/${media.id}/transcription/retry`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    if (++retries === 1)
      return route.fulfill({
        status: 500,
        json: { error: "Check folder permissions and try again." },
      });
    job = { ...job, status: "running", phase: "transcribing" };
    return route.fulfill({ status: 202, json: job });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/media/${media.id}`);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  await expect(panel.getByRole("status")).toContainText("Loading Parakeet Ultra");
  await panel.getByRole("button", { name: "Cancel transcription", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Transcription cancelled.");
  await panel.getByRole("button", { name: "Retry transcription", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Check folder permissions and try again.");
  await panel.getByRole("button", { name: "Retry transcription", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Transcribing");
  job = {
    ...job,
    status: "completed",
    phase: "finished",
    transcript: { language: null, segments: [] },
    cleanupError: "Could not remove temporary transcription files. Check folder permissions.",
  };
  await page.reload();
  await expect(
    panel.getByText("No speech was detected in this recording.", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText("temporary transcription files");
  await expect(panel.getByRole("button", { name: "Copy text", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: /^Download /u })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Retry transcription", exact: true })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("keeps retry progress when an older failed status arrives after retry succeeds", async ({
  page,
  request,
}) => {
  const title = `Retry ${randomUUID()}`;
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": encodeURIComponent(`${title}.wav`) },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  const failed: TranscriptionJob = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    status: "failed",
    phase: "finished",
    transcript: null,
    error: "The previous transcription failed.",
    cleanupError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let job = failed;
  let reads = 0;
  let delayRead: (route: Route) => void;
  const delayed = new Promise<Route>((resolve) => {
    delayRead = resolve;
  });
  await page.route(`**/api/media/${media.id}/transcription`, async (route) => {
    expect(route.request().method()).toBe("GET");
    if (++reads === 2) {
      delayRead(route);
    } else {
      await route.fulfill({ json: job });
    }
  });
  await page.route(`**/api/media/${media.id}/transcription/retry`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    job = { ...job, status: "running", phase: "transcribing", error: null };
    return route.fulfill({ status: 202, json: job });
  });
  await page.goto(`/media/${media.id}`);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  await expect(
    panel.getByRole("button", { name: "Retry transcription", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  const staleRead = await delayed;
  await panel.getByRole("button", { name: "Retry transcription", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Transcribing");
  job = {
    ...job,
    status: "completed",
    phase: "finished",
    transcript: {
      language: "en",
      segments: [{ startMs: 0, endMs: 1000, text: "The retried transcription completed." }],
    },
  };
  await staleRead.fulfill({ json: failed });
  await expect(
    panel.getByText("The retried transcription completed.", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Retry transcription", exact: true })).toHaveCount(
    0,
  );
});
