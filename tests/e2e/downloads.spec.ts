import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Schema } from "effect";
import type { DownloadJob } from "../../src/shared/contracts/downloads.ts";
import type { YtdlpStatus } from "../../src/shared/contracts/media-tools.ts";
import { MediaItem } from "../../src/shared/contracts/media.ts";

const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const wave = readFileSync(new URL("../fixtures/tone.wav", import.meta.url));
const readyYtdlp: YtdlpStatus = {
  ytdlp: { state: "ready", source: "system", version: "2026.10.26" },
  download: null,
  installation: { phase: "idle", downloadedBytes: 0, error: null },
};
const jobFixture = (): DownloadJob => ({
  id: randomUUID(),
  url,
  preset: "video-1080p",
  transcribe: false,
  title: "A queued video",
  durationSeconds: null,
  status: "running",
  phase: "downloading",
  downloadedBytes: 1024,
  totalBytes: 4096,
  error: null,
  cleanupError: null,
  mediaId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/ytdlp", (route) => route.fulfill({ json: readyYtdlp }));
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
  await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveAttribute(
    "href",
    `/media/${job.mediaId}`,
  );
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
});

for (const choice of [
  { preset: "video-480p", option: "480p", label: "Video · up to 480p" },
  { preset: "video-720p", option: "720p", label: "Video · up to 720p" },
  { preset: "video-best", option: "Best", label: "Video · best available" },
  { preset: "audio", option: "Audio only", label: "Audio · best available" },
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
        expect(route.request().postDataJSON()).toEqual({
          urls: [url],
          preset: choice.preset,
          transcribe: false,
        });
        queued = true;
        return route.fulfill({ status: 202, json: [job] });
      }
      expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: queued ? [job] : [] });
    });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto("/");
    await page.getByRole("button", { name: "Download from link", exact: true }).click();
    await page.getByRole("textbox", { name: "Video links" }).fill(url);
    await page.getByRole("button", { name: "Check link", exact: true }).click();
    const saveAs = page.getByRole("group", { name: "Save as" });
    await expect(saveAs.getByRole("button", { name: "Video" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const quality = page.getByRole("group", { name: "Quality" });
    await expect(quality.getByRole("button", { name: "1080p" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if (choice.preset === "audio") {
      await saveAs.getByRole("button", { name: choice.option }).click();
    } else {
      await quality.getByRole("button", { name: choice.option }).click();
    }
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
    await expect(page.getByText(choice.label)).toBeVisible();
    await page.reload();
    await expect(page.getByText(choice.label)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test("queues several pasted links from the downloads page without previewing them", async ({
  page,
}) => {
  const urls = [url, "https://x.com/example/status/123"];
  const jobs = urls.map((sourceUrl) => ({ ...jobFixture(), id: randomUUID(), url: sourceUrl }));
  let queued = false;
  let previewed = false;
  await page.route("**/api/downloads/preview", (route) => {
    previewed = true;
    return route.abort();
  });
  await page.route("**/api/downloads", (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        urls,
        preset: "audio",
        transcribe: false,
      });
      queued = true;
      return route.fulfill({ status: 202, json: jobs });
    }
    return route.fulfill({ json: queued ? jobs : [] });
  });
  await page.goto("/downloads");
  const openDialog = page.getByRole("button", { name: "Download from link", exact: true });
  await openDialog.click();
  const links = page.getByRole("textbox", { name: "Video links" });
  await links.fill(` ${urls[0]}`);
  await links.press("Shift+Enter");
  await links.pressSequentially(`${urls[1]} `);
  await expect(links).toHaveValue(` ${urls.join("\n")} `);
  await links.press("Enter");
  await expect(page.getByText("2 links", { exact: true })).toBeVisible();
  await page
    .getByRole("group", { name: "Save as" })
    .getByRole("button", { name: "Audio only" })
    .click();
  await page.getByRole("button", { name: "Download all 2", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Download from a link" })).toBeHidden();
  await expect(page.getByRole("list", { name: "In progress" }).getByRole("listitem")).toHaveCount(
    2,
  );
  expect(previewed).toBe(false);
  await openDialog.click();
  await expect(links).toHaveValue("");
});

test("previews an X post, recovers from a source error and keeps polling while another recording is open", async ({
  page,
  request,
}) => {
  const inputUrl = "https://twitter.com/example/status/123?s=20";
  const sourceUrl = "https://x.com/i/web/status/123";
  const title = `While downloading ${randomUUID()}`;
  const imported = await request.post("/api/media", {
    headers: { "x-file-name": `${title}.wav` },
    data: wave,
  });
  expect(imported.status()).toBe(201);
  const item = Schema.decodeUnknownSync(MediaItem)(await imported.json());
  let job = { ...jobFixture(), url: sourceUrl };
  let queued = false;
  let previewAttempts = 0;
  await page.route("**/api/downloads", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        urls: [sourceUrl],
        preset: "video-1080p",
        transcribe: false,
      });
      queued = true;
      await route.fulfill({ status: 202, json: [job] });
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
        ? {
            status: 503,
            json: {
              error:
                "This X video is unavailable to Movo. Use a public post that opens without signing in, or try again later.",
            },
          }
        : { json: { url: sourceUrl, title: job.title, durationSeconds: null } },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  await page.getByRole("textbox", { name: "Video links" }).fill(inputUrl);
  await page.getByRole("button", { name: "Check link", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Use a public post that opens without signing in",
  );
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check link", exact: true }).click();
  await expect(page.getByText(/· Duration unknown$/u)).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "In progress" })).toContainText("Downloading");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Library", exact: true })
    .click();
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expect(page.getByRole("region", { name: "Player", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Downloading/u })).toBeVisible();
  job = { ...job, status: "completed", phase: "finished", mediaId: item.id };
  await expect(page.getByRole("link", { name: /^Downloading/u })).toHaveCount(0);
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  await expect(page.getByRole("list", { name: "Recent" })).toContainText("Saved to library");
  await page.getByRole("link", { name: "Open", exact: true }).click();
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
