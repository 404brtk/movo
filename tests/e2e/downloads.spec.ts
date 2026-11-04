import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Schema } from "effect";
import type { DownloadJob } from "../../src/shared/contracts/downloads.ts";
import { MediaItem } from "../../src/shared/contracts/media.ts";

const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const wave = readFileSync(new URL("../fixtures/tone.wav", import.meta.url));
const jobFixture = (): DownloadJob => ({
  id: randomUUID(),
  url,
  title: "A queued video",
  durationSeconds: null,
  status: "running",
  phase: "downloading",
  downloadedBytes: 1024,
  error: null,
  mediaId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test("previews a link, recovers from a source error and keeps polling while another recording is open", async ({
  page,
  request,
}) => {
  const title = `While downloading ${randomUUID()}`;
  const imported = await request.post("/api/media", {
    headers: { "x-file-name": `${title}.wav` },
    data: wave,
  });
  expect(imported.status()).toBe(201);
  const item = Schema.decodeUnknownSync(MediaItem)(await imported.json());
  let job = jobFixture();
  let queued = false;
  let previewAttempts = 0;
  await page.route("**/api/downloads", async (route) => {
    if (route.request().method() === "POST") {
      queued = true;
      await route.fulfill({ status: 202, json: job });
    } else await route.fulfill({ json: queued ? [job] : [] });
  });
  await page.route("**/api/downloads/preview", async (route) => {
    previewAttempts++;
    await route.fulfill(
      previewAttempts === 1
        ? { status: 503, json: { error: "The source is temporarily unavailable." } }
        : { json: { url, title: job.title, durationSeconds: null } },
    );
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "YouTube link" }).fill(url);
  await page.getByRole("button", { name: "Check link", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("The source is temporarily unavailable.");
  await page.getByRole("button", { name: "Check link", exact: true }).click();
  await expect(page.getByText("Duration unknown", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Download jobs" })).toContainText("Downloading");
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expect(page.locator("audio")).toBeVisible();
  await expect(page.getByRole("link", { name: "Downloads 1", exact: true })).toBeVisible();
  job = { ...job, status: "completed", phase: "finished", mediaId: item.id };
  await expect(page.getByRole("link", { name: "Downloads", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  await expect(page.getByRole("list", { name: "Download jobs" })).toContainText("Saved to library");
  await page.getByRole("link", { name: "Open media", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("retries and cancels a download, retains its state after reload and fits a narrow screen", async ({
  page,
}, testInfo) => {
  let job: DownloadJob = {
    ...jobFixture(),
    status: "failed",
    phase: "finished",
    error: "The connection was interrupted.",
  };
  await page.route("**/api/downloads", (route) => route.fulfill({ json: [job] }));
  await page.route("**/api/downloads/*/retry", async (route) => {
    job = { ...job, status: "running", phase: "checking", error: null };
    await route.fulfill({ status: 202, json: job });
  });
  await page.route("**/api/downloads/*/cancel", async (route) => {
    job = { ...job, status: "cancelled", phase: "finished" };
    await route.fulfill({ json: job });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/downloads");
  await expect(page.getByText("The connection was interrupted.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Checking video", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Cancelled", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("downloads-mobile.png"), fullPage: true });
});
