import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Schema } from "effect";
import { type DownloadJob, DownloadPreviewRequest } from "../../src/shared/contracts/downloads.ts";
import type { YtdlpStatus } from "../../src/shared/contracts/media-tools.ts";
import { MediaItem } from "../../src/shared/contracts/media.ts";

const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const wave = readFileSync(new URL("../fixtures/tone.wav", import.meta.url));
const readyYtdlp: YtdlpStatus = {
  ytdlp: { state: "ready", source: "system", version: "2026.10.26" },
  download: null,
  installation: { phase: "idle", downloadedBytes: 0, error: null },
};
const scrollingAreas = (dialog: HTMLElement | SVGElement) =>
  [...dialog.querySelectorAll("*")]
    .filter(
      (element) =>
        ["auto", "scroll"].includes(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight,
    )
    .map((element) => element.getAttribute("aria-label") ?? element.tagName);
const fitsRows = (element: HTMLElement | SVGElement) =>
  [...element.children].reduce((height, row) => height + row.getBoundingClientRect().height, 0) >=
  element.clientHeight - 1;
const byText = (left: string, right: string) => left.localeCompare(right);
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
  { preset: "audio", option: "Audio", label: "Audio · best available" },
] as const) {
  test(`queues ${choice.preset} and shows the selected option after reload`, async ({ page }) => {
    let queued = false;
    const title = "A source recording";
    const job = { ...jobFixture(), preset: choice.preset, title };
    await page.route("**/api/downloads/preview", (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ url });
      return route.fulfill({ json: { url, title, durationSeconds: 2 } });
    });
    await page.route("**/api/downloads", (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({
          links: [{ url, preset: choice.preset, title }],
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
    const links = page.getByRole("textbox", { name: "Add links" });
    await links.fill(url);
    await links.press("Enter");
    await expect(links).toHaveValue("");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    const saveAs = page.getByRole("group", { name: `Save ${title} as` });
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
      await expect(quality).toHaveCount(0);
    } else {
      await quality.getByRole("button", { name: choice.option }).click();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Download from links" })).toBeHidden();
    await expect(page.getByText("1 download added", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View downloads", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
    await expect(page.getByText(choice.label)).toBeVisible();
    await page.reload();
    await expect(page.getByText(choice.label)).toBeVisible();
  });
}

test("checks several links, explains skipped ones and queues each with its own choice", async ({
  page,
}) => {
  const xUrl = "https://x.com/i/web/status/123";
  const episode = "https://podcasts.apple.com/podcast/id1?i=2";
  const titles: Record<string, string> = {
    [url]: "A lecture saved before",
    [xUrl]: "A short post",
    [episode]: "A podcast episode",
  };
  const saved: DownloadJob = {
    ...jobFixture(),
    status: "completed",
    phase: "finished",
    mediaId: randomUUID(),
  };
  const queuedJobs = [url, xUrl, episode].map((sourceUrl) => ({
    ...jobFixture(),
    id: randomUUID(),
    url: sourceUrl,
    status: "queued" as const,
    phase: "queued" as const,
  }));
  let queued = false;
  let answerQueue: (() => void) | undefined;
  const queueAnswered = new Promise<void>((resolve) => {
    answerQueue = resolve;
  });
  const previewed: string[] = [];
  await page.route("**/api/downloads/preview", (route) => {
    const previewUrl = Schema.decodeUnknownSync(DownloadPreviewRequest)(
      route.request().postDataJSON(),
    ).url;
    previewed.push(previewUrl);
    return route.fulfill({
      json: { url: previewUrl, title: titles[previewUrl], durationSeconds: 90 },
    });
  });
  await page.route("**/api/downloads", async (route) => {
    if (route.request().method() === "POST") {
      await queueAnswered;
      expect(route.request().postDataJSON()).toEqual({
        links: [
          { url, preset: "audio", title: titles[url] },
          { url: xUrl, preset: "audio", title: titles[xUrl] },
          { url: episode, preset: "audio", title: titles[episode] },
        ],
        transcribe: false,
      });
      queued = true;
      return route.fulfill({ status: 202, json: queuedJobs });
    }
    return route.fulfill({ json: queued ? [saved, ...queuedJobs] : [saved] });
  });
  await page.goto("/downloads");
  const openDialog = page.getByRole("button", { name: "Download from link", exact: true });
  await openDialog.click();
  const links = page.getByRole("textbox", { name: "Add links" });
  await links.fill(
    ` ${url} https://twitter.com/example/status/123?s=20 https://open.spotify.com/episode/abc https://podcasts.apple.com/us/podcast/a-show/id1?i=2 https://youtu.be/aaaaaaaaaaa`,
  );
  await links.press("Enter");
  const list = page.getByRole("list", { name: "Links" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText("4 links", { exact: true })).toBeVisible();
  await expect(list).toContainText("open.spotify.com isn’t supported");
  await expect(list).toContainText("Already saved as video");
  await expect(list.getByRole("listitem").filter({ hasText: "A podcast episode" })).toContainText(
    "Audio only",
  );
  await expect(page.getByRole("button", { name: "Download 2", exact: true })).toBeEnabled();
  await page
    .getByRole("group", { name: "Save every link as" })
    .getByRole("button", { name: "Audio" })
    .click();
  await expect(page.getByRole("group", { name: "Quality" })).toHaveCount(0);
  await expect(list).not.toContainText("Already saved");
  await page.getByRole("button", { name: "Download 3", exact: true }).click();
  await expect(links).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove A short post" })).toBeDisabled();
  await expect(
    page
      .getByRole("group", { name: "Save A short post as" })
      .getByRole("button", { name: "Video" }),
  ).toBeDisabled();
  answerQueue?.();
  await expect(page.getByRole("dialog", { name: "Download from links" })).toBeHidden();
  await expect(page.getByText("3 downloads added", { exact: true })).toBeVisible();
  await expect(page.getByText("1 link skipped.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View downloads" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "In progress" }).getByRole("listitem")).toHaveCount(
    3,
  );
  expect(previewed.toSorted(byText)).toEqual([url, xUrl, episode].toSorted(byText));
  await openDialog.click();
  await expect(links).toHaveValue("");
  await expect(page.getByRole("list", { name: "Links" })).toHaveCount(0);
});

test("checks an X post again after a source error and keeps polling while another recording is open", async ({
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
        links: [{ url: sourceUrl, preset: "video-1080p", title: job.title }],
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
    expect(route.request().postDataJSON()).toEqual({ url: sourceUrl });
    previewAttempts++;
    await route.fulfill(
      previewAttempts === 1
        ? {
            status: 503,
            json: {
              error:
                "This X link is unavailable to Movo. Use a public link that opens without signing in, or try again later.",
            },
          }
        : { json: { url: sourceUrl, title: job.title, durationSeconds: null } },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const links = page.getByRole("textbox", { name: "Add links" });
  await links.fill(inputUrl);
  await links.press("Enter");
  const list = page.getByRole("list", { name: "Links" });
  await expect(list).toContainText("Use a public link that opens without signing in");
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
  await list.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(list.getByText(job.title ?? "", { exact: true })).toBeVisible();
  await expect(list).toContainText("x.com");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("button", { name: "View downloads", exact: true }).click();
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

test("scrolls only the link list, keeps the options in view and keeps links past the limit", async ({
  page,
}) => {
  const urls = Array.from(
    { length: 21 },
    (_, index) => `https://www.youtube.com/watch?v=${String(index).padStart(11, "a")}`,
  );
  await page.route("**/api/downloads/preview", (route) => {
    const previewUrl = Schema.decodeUnknownSync(DownloadPreviewRequest)(
      route.request().postDataJSON(),
    ).url;
    return route.fulfill({
      json: { url: previewUrl, title: `Video ${previewUrl.slice(-11)}`, durationSeconds: 60 },
    });
  });
  await page.route("**/api/downloads", (route) => route.fulfill({ json: [] }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const links = page.getByRole("textbox", { name: "Add links" });
  await links.fill(urls[0] ?? "");
  await links.press("Enter");
  const list = page.getByRole("list", { name: "Links" });
  const dialog = page.getByRole("dialog", { name: "Download from links" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(await list.evaluate(fitsRows)).toBe(true);
  expect(await dialog.evaluate(scrollingAreas)).toEqual([]);
  await links.fill(urls.slice(1).join("\n"));
  await links.press("Enter");
  await expect(list.getByRole("listitem")).toHaveCount(20);
  await expect(links).toHaveValue(urls[20] ?? "");
  expect(await dialog.evaluate(scrollingAreas)).toEqual(["Links"]);
  await expect(links).toBeInViewport();
  await expect(page.getByRole("group", { name: "Quality" })).toBeInViewport();
  const download = page.getByRole("button", { name: "Download 20", exact: true });
  await expect(download).toBeInViewport();
  await download.click();
  await expect(page.getByText("20 downloads added", { exact: true })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(links).toHaveValue("");
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
