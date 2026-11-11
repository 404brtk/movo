import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const wave = readFileSync(resolve("tests/fixtures/tone.wav"));
const video = readFileSync(resolve("tests/fixtures/sample.webm"));

async function chooseAction(page: Page, name: string) {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

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
  await chooseAction(page, "Save a copy");
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
  await expect(page.getByRole("alert")).toContainText("Could not read this media file", {
    timeout: 15000,
  });
  const title = `Recovered import ${randomUUID()}`;
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("shows a useful missing-item page for a direct link", async ({ page }) => {
  await page.goto(`/media/${randomUUID()}`);
  await expect(
    page.getByRole("heading", { name: "This page doesn’t exist", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
});

test("renames a recording, recovers from a rejected save and retains the title after reload", async ({
  page,
  request,
}) => {
  const title = `Rename ${randomUUID()}`;
  const renamed = `Rozmowa 🎙️ ${randomUUID()}`;
  await page.goto("/");
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  const more = page.getByRole("button", { name: "More actions", exact: true });
  await chooseAction(page, "Rename recording");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("unsaved");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(more).toBeFocused();
  await chooseAction(page, "Rename recording");
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
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    `  ${renamed}  `,
  );
  await page.unroute(endpoint);
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(more).toBeFocused();
  await expectFixturePlayback(page.locator("audio"));
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Save a copy" })).toHaveAttribute(
    "download",
    `${title}.wav`,
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  const newer = `Renamed elsewhere ${randomUUID()}`;
  const renamedElsewhere = await request.patch(`/api${new URL(page.url()).pathname}`, {
    data: { title: newer },
  });
  expect(renamedElsewhere.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: newer, exact: true })).toBeVisible();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(newer);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("link", { name: `Open ${newer}`, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Open ${renamed}`, exact: true })).toHaveCount(0);
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
  const trigger = page.getByRole("button", { name: "More actions", exact: true });
  await chooseAction(page, "Delete recording…");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Your original imported file stays where it is.");
  await expect(dialog.getByRole("button", { name: "Keep recording" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await chooseAction(page, "Delete recording…");
  await dialog.getByRole("button", { name: "Keep recording" }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.route(`**${apiPath}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fulfill({
      status: 409,
      json: { error: "Cancel the transcription before deleting this recording." },
    });
  });
  await chooseAction(page, "Delete recording…");
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
  await expect(
    page.getByRole("heading", { name: "This page doesn’t exist", exact: true }),
  ).toBeVisible();
});

test("keeps confirmation buttons reachable for a long title on a short screen", async ({
  page,
}) => {
  const name = `Long ${randomUUID()}`;
  const title = `${"A long recording title ".repeat(20)}${randomUUID()}`.slice(0, 512);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto("/");
  await page
    .getByLabel("Choose media file")
    .setInputFiles({ name: `${name}.wav`, mimeType: "audio/wav", buffer: wave });
  await page.getByRole("link", { name: `Open ${name}`, exact: true }).click();
  const apiPath = `/api${new URL(page.url()).pathname}`;
  expect((await page.request.patch(apiPath, { data: { title } })).status()).toBe(200);
  await page.reload();
  await chooseAction(page, "Delete recording…");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(title);
  const keep = dialog.getByRole("button", { name: "Keep recording" });
  await keep.scrollIntoViewIfNeeded();
  await expect(keep).toBeInViewport({ ratio: 1 });
  await keep.click();
  await expect(dialog).toHaveCount(0);
  expect((await page.request.delete(apiPath)).status()).toBe(200);
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
  await chooseAction(page, "Delete recording…");
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

const listedRecording = (id: string, title: string, transcription: "none" | "done") => ({
  id,
  title,
  originalName: `${title}.wav`,
  kind: "audio",
  contentType: "audio/wav",
  byteSize: 1000,
  durationSeconds: 2,
  importedAt: Date.now(),
  sourceUrl: null,
  fileRemovedAt: null,
  transcription,
});

test("starts a transcription from its row button and opens the recording from its status", async ({
  page,
}) => {
  const fresh = randomUUID();
  const transcribed = randomUUID();
  const queued: string[] = [];
  await page.route("**/api/media", (route) =>
    route.fulfill({
      json: {
        items: [
          listedRecording(fresh, "Fresh notes", "none"),
          listedRecording(transcribed, "Done notes", "done"),
        ],
        transcribing: false,
      },
    }),
  );
  await page.route(`**/api/media/${fresh}/transcription`, (route) => {
    if (route.request().method() === "POST") queued.push(fresh);
    return route.fulfill({ status: 404, json: { error: "Not transcribed." } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect.poll(() => queued).toEqual([fresh]);
  await expect(page).toHaveURL(/\/$/u);
  const status = await page
    .getByRole("region", { name: "Media library" })
    .getByText("Transcribed", { exact: true })
    .boundingBox();
  await page.mouse.click(
    (status?.x ?? 0) + (status?.width ?? 0) / 2,
    (status?.y ?? 0) + (status?.height ?? 0) / 2,
  );
  await expect(page).toHaveURL(new RegExp(`/media/${transcribed}$`, "u"));
});
