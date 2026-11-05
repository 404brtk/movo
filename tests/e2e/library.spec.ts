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

test("renames a recording, recovers from a rejected save and retains the title after reload", async ({
  page,
}) => {
  const title = `Rename ${randomUUID()}`;
  const renamed = `Rozmowa 🎙️ ${randomUUID()}`;
  await page.goto("/");
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("unsaved");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("   ");
  await expect(page.getByRole("button", { name: "Save title", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(`  ${renamed}  `);
  const endpoint = `**/api${new URL(page.url()).pathname}`;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    expect(route.request().postDataJSON()).toEqual({ title: renamed });
    await route.fulfill({ status: 500, json: { error: "Could not save this title." } });
  });
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not save this title.");
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.unroute(endpoint);
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeFocused();
  await expectFixturePlayback(page.locator("audio"));
  await expect(page.getByRole("link", { name: "Save a copy" })).toHaveAttribute(
    "download",
    `${title}.wav`,
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("link", { name: `Open ${renamed}`, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toHaveCount(0);
});

test("confirms deletion, preserves the recording after failure and removes it after retry", async ({
  page,
}) => {
  const title = `Delete ${randomUUID()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  const detailUrl = page.url();
  const apiPath = `/api${new URL(detailUrl).pathname}`;
  const trigger = page.getByRole("button", { name: "Delete recording", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Your original imported file stays where it is.");
  await expect(dialog.getByRole("button", { name: "Keep recording" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Keep recording" }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.route(`**${apiPath}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fulfill({
      status: 409,
      json: { error: "Cancel the transcription before deleting this recording." },
    });
  });
  await trigger.click();
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Cancel the transcription before deleting this recording.",
  );
  expect((await page.request.get(apiPath)).status()).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.unroute(`**${apiPath}`);
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toHaveCount(0);
  expect((await page.request.get(`${apiPath}/file`)).status()).toBe(404);
  await page.reload();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toHaveCount(0);
  await page.goto(detailUrl);
  await expect(page.getByRole("heading", { name: "Media not found", exact: true })).toBeVisible();
});

test("shows a committed deletion cleanup warning and returns to the library without offering another deletion", async ({
  page,
}) => {
  const title = `Cleanup warning ${randomUUID()}`;
  await page.goto("/");
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  const apiPath = `/api${new URL(page.url()).pathname}`;
  const cleanupError =
    "The recording was removed from the library, but its saved copy could not be cleaned up. Close apps using it or check folder permissions, then restart Movo to retry cleanup.";
  await page.route(`**${apiPath}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({ response, json: { ...(await response.json()), cleanupError } });
  });
  await page.getByRole("button", { name: "Delete recording", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Recording deleted", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText(cleanupError);
  await expect(dialog.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Keep recording" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Back to library" })).toBeFocused();
  expect((await page.request.get(apiPath)).status()).toBe(404);
  await dialog.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toHaveCount(0);
});
