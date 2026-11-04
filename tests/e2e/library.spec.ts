import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator } from "@playwright/test";

const wave = readFileSync(resolve("tests/fixtures/tone.wav"));
const video = readFileSync(resolve("tests/fixtures/sample.webm"));

async function expectFixturePlayback(player: Locator) {
  await expect
    .poll(() => player.evaluate((element: HTMLMediaElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => player.evaluate((element: HTMLMediaElement) => element.duration))
    .toBeCloseTo(2, 1);
  await player.evaluate(async (element: HTMLMediaElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => player.evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeGreaterThan(0);
  await player.evaluate((element: HTMLMediaElement) => {
    element.pause();
    element.currentTime = 1;
  });
  await expect
    .poll(() => player.evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeCloseTo(1, 1);
}

test("imports audio, plays and seeks, reloads metadata and saves an identical copy", async ({
  page,
}, testInfo) => {
  const title = `Próbka mowy ${randomUUID()}`;
  const name = `${title}.wav`;
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Import a file" })).toBeEnabled();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import a file" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: "audio/wav", buffer: wave });
  const itemLink = page.getByRole("link", { name: `Open ${title}`, exact: true });
  await expect(itemLink).toBeVisible();
  await itemLink.click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expectFixturePlayback(page.locator("audio"));
  await page.reload();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Save a copy" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(name);
  const savedPath = testInfo.outputPath("saved-copy.wav");
  await download.saveAs(savedPath);
  expect(readFileSync(savedPath)).toEqual(wave);
  await page.screenshot({ path: testInfo.outputPath("audio-detail.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(itemLink).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Import a file" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("library-mobile.png"), fullPage: true });
});

test("imports video and loads a seekable native player", async ({ page }, testInfo) => {
  const title = `Local video ${randomUUID()}`;
  await page.goto("/");
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.webm`, mimeType: "video/webm", buffer: video });
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expectFixturePlayback(page.locator("video"));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("video-detail.png"), fullPage: true });
});

test("rejects invalid media and allows a subsequent valid import", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Choose media file").setInputFiles({
    name: "invalid.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not media"),
  });
  await expect(page.getByRole("alert")).toContainText("Could not read this media file");
  const title = `Recovered import ${randomUUID()}`;
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("shows a useful missing-item page for a direct link", async ({ page }) => {
  await page.goto(`/media/${randomUUID()}`);
  await expect(page.getByRole("heading", { name: "Media not found", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
});
