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
  preset: "video-1080p",
  title: "A queued video",
  durationSeconds: null,
  status: "running",
  phase: "downloading",
  downloadedBytes: 1024,
  error: null,
  cleanupError: null,
  mediaId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test("keeps saved media available when temporary download cleanup fails", async ({ page }) => {
  const job: DownloadJob = {
    ...jobFixture(),
    status: "completed",
    phase: "finished",
    mediaId: randomUUID(),
    cleanupError:
      "Could not remove temporary download files. Close apps using them, then restart Movo.",
  };
  await page.route("**/api/downloads", (route) => route.fulfill({ json: [job] }));
  await page.goto("/downloads");
  await expect(page.getByText("Saved to library", { exact: false })).toBeVisible();
  await expect(page.getByText(job.cleanupError ?? "", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open media", exact: true })).toHaveAttribute(
    "href",
    `/media/${job.mediaId}`,
  );
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
});

for (const choice of [
  { preset: "video-480p", label: "Video · Up to 480p" },
  { preset: "video-720p", label: "Video · Up to 720p" },
  { preset: "video-best", label: "Video · Best available" },
  { preset: "audio", label: "Audio · Best available" },
] as const) {
  test(`queues ${choice.preset} and shows the selected option after reload`, async ({ page }) => {
    let queued = false;
    const job = { ...jobFixture(), preset: choice.preset };
    await page.route("**/api/downloads/preview", (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ url });
      return route.fulfill({ json: { url, title: "A source recording", durationSeconds: 2 } });
    });
    await page.route("**/api/downloads", (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({ url, preset: choice.preset });
        queued = true;
        return route.fulfill({ status: 202, json: job });
      }
      expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: queued ? [job] : [] });
    });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "YouTube link" }).fill(url);
    await page.getByRole("button", { name: "Check link", exact: true }).click();
    await expect(page.getByLabel("Save as", { exact: true })).toHaveValue("video");
    await expect(page.getByLabel("Video quality", { exact: true })).toHaveValue("video-1080p");
    if (choice.preset === "audio") {
      await page.getByLabel("Save as", { exact: true }).selectOption("audio");
    } else {
      await page.getByLabel("Video quality", { exact: true }).selectOption(choice.preset);
    }
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
    await expect(page.getByText(choice.label, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(choice.label, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test("previews a link, recovers from a source error and keeps polling while another recording is open", async ({
  page,
  request,
}) => {
  const inputUrl = "https://youtu.be/aaaaaaaaaaa?si=sharing";
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
      expect(route.request().postDataJSON()).toEqual({ url, preset: "video-1080p" });
      queued = true;
      await route.fulfill({ status: 202, json: job });
    } else {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({ json: queued ? [job] : [] });
    }
  });
  await page.route("**/api/downloads/preview", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ url: inputUrl });
    previewAttempts++;
    await route.fulfill(
      previewAttempts === 1
        ? { status: 503, json: { error: "The source is temporarily unavailable." } }
        : { json: { url, title: job.title, durationSeconds: null } },
    );
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "YouTube link" }).fill(inputUrl);
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
  await page.route("**/api/downloads", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: [job] });
  });
  await page.route(`**/api/downloads/${job.id}/retry`, async (route) => {
    expect(route.request().method()).toBe("POST");
    job = { ...job, status: "running", phase: "checking", error: null };
    await route.fulfill({ status: 202, json: job });
  });
  await page.route(`**/api/downloads/${job.id}/cancel`, async (route) => {
    expect(route.request().method()).toBe("POST");
    job = { ...job, status: "cancelled", phase: "finished" };
    await route.fulfill({ json: job });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/downloads");
  await expect(page.getByText("The connection was interrupted.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Checking source", { exact: false })).toBeVisible();
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
