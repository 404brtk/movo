import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Schema } from "effect";
import {
  DownloadCollectionRequest,
  type DownloadJob,
  DownloadPreviewRequest,
} from "../../src/shared/contracts/downloads.ts";
import type { YtdlpStatus } from "../../src/shared/contracts/media-tools.ts";
import { MediaItem } from "../../src/shared/contracts/media.ts";

const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const playlist = "https://www.youtube.com/playlist?list=PLabcdefghijk";
const channel = "https://www.youtube.com/@example/videos";
const collectionVideo = (index: number) => ({
  title: `Collection video ${index}`,
  url: `https://www.youtube.com/watch?v=${String(index).padStart(11, "0")}`,
  durationSeconds: index === 51 ? null : 62,
});
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

test("keeps video links in a mixed paste and offers only supported collections", async ({
  page,
}) => {
  const watch = collectionVideo(8);
  const mixWatch = collectionVideo(9);
  const collectionReads: unknown[] = [];
  await page.route("**/api/downloads/collection", (route) => {
    collectionReads.push(route.request().postDataJSON());
    return route.fulfill({ json: { title: "Public channel", videos: [watch], nextCursor: null } });
  });
  await page.route("**/api/downloads/preview", (route) => {
    const { url: videoUrl } = Schema.decodeUnknownSync(DownloadPreviewRequest)(
      route.request().postDataJSON(),
    );
    const video = videoUrl === watch.url ? watch : mixWatch;
    return route.fulfill({ json: { ...video, saved: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Add links" });
  await field.evaluate(
    (element, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", value);
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
    },
    [
      `${watch.url}&list=PLabcdefghijk`,
      "https://m.youtube.com/@Example",
      "https://www.youtube.com/playlist?list=RDMM",
      `${mixWatch.url}&list=RDMM`,
    ].join("\n"),
  );
  const form = page.getByRole("dialog", { name: "Download from links" });
  await expect(form.getByRole("status")).toContainText(
    "This is a YouTube Mix. Paste a link to a specific video.",
  );
  await expect(
    form.getByRole("list", { name: "Links", exact: true }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(form.getByRole("list", { name: "Links", exact: true })).toContainText(watch.title);
  await expect(form.getByRole("list", { name: "Links", exact: true })).toContainText(
    mixWatch.title,
  );
  await expect(form.getByRole("button", { name: "Choose from playlist", exact: true })).toHaveCount(
    1,
  );
  await expect(form.getByRole("button", { name: "Choose videos", exact: true })).toHaveCount(1);
  expect(collectionReads).toEqual([]);

  await form.getByRole("button", { name: "Choose videos", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose videos" });
  await expect(picker.getByText("Public channel", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(picker.getByRole("checkbox", { name: new RegExp(watch.title) })).toBeDisabled();
  await expect(picker.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await picker.getByRole("button", { name: "Back to links" }).press("Enter");
  await expect(field).toBeFocused();
  await expect(
    form.getByRole("list", { name: "Links", exact: true }).getByRole("listitem"),
  ).toHaveCount(2);
  expect(collectionReads).toEqual([{ url: channel }]);
});

test("loads collection pages on demand, preserves selection and queues videos in source order", async ({
  page,
}) => {
  const draft = [
    collectionVideo(0),
    ...Array.from({ length: 17 }, (_, index) => collectionVideo(index + 100)),
  ];
  const firstPage = Array.from({ length: 50 }, (_, index) => collectionVideo(index));
  const earlier = collectionVideo(49);
  const later = collectionVideo(51);
  const cursor = "d859c338-9ea4-481d-bee0-0f4f7881e014";
  const pages: (string | undefined)[] = [];
  const enqueued: unknown[] = [];
  await page.clock.install();
  await page.route("**/api/downloads/collection", (route) => {
    expect(route.request().method()).toBe("POST");
    const request = Schema.decodeUnknownSync(DownloadCollectionRequest)(
      route.request().postDataJSON(),
    );
    expect(request.url).toBe(playlist);
    pages.push(request.cursor);
    if (request.cursor && pages.length === 2)
      return route.fulfill({ status: 503, json: { error: "YouTube is temporarily unavailable." } });
    return route.fulfill({
      json: {
        title: "Public playlist",
        videos: request.cursor ? [earlier, collectionVideo(50), later] : firstPage,
        nextCursor: request.cursor ? null : cursor,
      },
    });
  });
  await page.route("**/api/downloads/preview", (route) => {
    const { url: videoUrl } = Schema.decodeUnknownSync(DownloadPreviewRequest)(
      route.request().postDataJSON(),
    );
    const index = Number(new URL(videoUrl).searchParams.get("v"));
    return route.fulfill({ json: { ...collectionVideo(index), saved: [] } });
  });
  await page.route("**/api/downloads", (route) => {
    if (route.request().method() === "POST") {
      enqueued.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.setViewportSize({ width: 320, height: 620 });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Download from links" });
  const field = form.getByRole("textbox", { name: "Add links" });
  await field.fill([...draft.map((video) => video.url), "https://youtu.be/00000000000"].join(" "));
  await field.press("Enter");
  await expect(
    form.getByRole("list", { name: "Links", exact: true }).getByRole("listitem"),
  ).toHaveCount(18);
  const quality = form
    .getByRole("group", { name: "Quality" })
    .getByRole("button", { name: "720p" });
  const transcribe = form.getByRole("switch", { name: "Transcribe after download" });
  await quality.click();
  await transcribe.click();
  await field.fill(`${playlist}&si=share`);
  await field.press("Enter");
  const picker = page.getByRole("dialog", { name: "Choose videos" });
  await expect(picker.getByText("Public playlist", { exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Back to links" })).toBeFocused();
  const videos = picker.getByRole("list", { name: "Collection videos" });
  const checkbox = (index: number) =>
    videos.getByRole("checkbox", { name: new RegExp(`^Collection video ${index}(?: |$)`) });
  await expect(videos.getByRole("checkbox")).toHaveCount(50);
  await expect(checkbox(0)).toBeDisabled();
  expect(await picker.evaluate(scrollingAreas)).toEqual(["Collection videos"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(videos.getByText("1:02").first()).toBeVisible();
  await checkbox(49).press("Space");
  await expect(checkbox(49)).toBeChecked();
  await expect(picker.getByText("1 selected", { exact: true })).toBeVisible();
  expect(pages).toEqual([undefined]);
  const scroll = await videos.evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await picker.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(picker.getByRole("alert")).toHaveText("YouTube is temporarily unavailable.");
  await expect(checkbox(49)).toBeChecked();
  await picker.getByRole("button", { name: "Retry load more" }).click();
  await expect(videos.getByRole("checkbox")).toHaveCount(52);
  expect(await videos.evaluate((element) => element.scrollTop)).toBe(scroll);
  await expect(checkbox(49)).toBeChecked();
  await expect(picker.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);

  await checkbox(49).press("Space");
  await checkbox(51).press("Space");
  await checkbox(49).press("Space");
  await expect(checkbox(50)).toBeDisabled();
  await expect(picker.getByText("20-link limit reached.")).toBeVisible();
  await picker.getByRole("button", { name: "Add 2 videos" }).click();
  await expect(field).toBeFocused();
  await expect(quality).toHaveAttribute("aria-pressed", "true");
  await expect(transcribe).toBeChecked();
  await expect(
    form.getByRole("list", { name: "Links", exact: true }).getByRole("listitem"),
  ).toHaveCount(20);
  await expect(form.getByText(later.title, { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Download 20", exact: true }).click();
  await expect(form.getByText("Public playlist", { exact: true })).toBeVisible();
  await expect(form.getByRole("list", { name: "Links", exact: true })).toHaveCount(0);
  expect(enqueued).toEqual([
    {
      links: [...draft, earlier, later].map(({ url: videoUrl, title }) => ({
        url: videoUrl,
        title,
        preset: "video-720p",
      })),
      transcribe: true,
    },
  ]);
  await form.getByRole("button", { name: "Choose videos", exact: true }).click();
  await expect(videos.getByRole("checkbox")).toHaveCount(52);
  await expect(picker.getByText("0 selected", { exact: true })).toBeVisible();
  expect(pages).toEqual([undefined, cursor, cursor]);
  await checkbox(50).press("Space");
  await picker.getByRole("button", { name: "Add 1 video" }).click();
  await expect(quality).toHaveAttribute("aria-pressed", "true");
  await expect(transcribe).toBeChecked();
  await form
    .getByRole("group", { name: `Save ${collectionVideo(50).title} as` })
    .getByRole("button", { name: "Audio" })
    .click();
  await page.clock.fastForward(5 * 60 * 1000 + 1);
  await expect(form.getByText("Public playlist", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Download", exact: true }).click();
  await expect
    .poll(() => enqueued.at(-1))
    .toEqual({
      links: [{ url: collectionVideo(50).url, title: collectionVideo(50).title, preset: "audio" }],
      transcribe: true,
    });
  await expect(form.getByText("Public playlist", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  await expect(form.getByRole("list", { name: "YouTube collections" })).toHaveCount(0);
});

test("keeps the selection available when a collection cursor expires and can restart", async ({
  page,
}) => {
  const first = collectionVideo(0);
  const replacement = collectionVideo(1);
  const cursor = "d859c338-9ea4-481d-bee0-0f4f7881e014";
  let starts = 0;
  await page.route("**/api/downloads/collection", (route) => {
    const request = Schema.decodeUnknownSync(DownloadCollectionRequest)(
      route.request().postDataJSON(),
    );
    if (request.cursor)
      return route.fulfill({ status: 409, json: { error: "This list has expired." } });
    starts++;
    return route.fulfill({
      json: {
        title: "Public playlist",
        videos: starts === 1 ? [first] : [replacement],
        nextCursor: starts === 1 ? cursor : null,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Add links" });
  await field.fill(playlist);
  await field.press("Enter");
  const picker = page.getByRole("dialog", { name: "Choose videos" });
  await picker.getByRole("checkbox", { name: new RegExp(first.title) }).press("Space");
  await picker.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("This list has expired.");
  await expect(picker.getByRole("button", { name: "Add 1 video" })).toBeEnabled();
  await picker.getByRole("button", { name: "Start again" }).click();
  await expect(picker.getByRole("checkbox", { name: new RegExp(replacement.title) })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Add videos" })).toBeDisabled();
  expect(starts).toBe(2);
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
  await expect(page.getByRole("link", { name: `Open ${job.title}`, exact: true })).toHaveAttribute(
    "href",
    `/media/${job.mediaId}`,
  );
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
});

test("opens downloads from the header slot, which counts downloads to retry until they are seen", async ({
  page,
}) => {
  let jobs: DownloadJob[] = [];
  await page.route("**/api/downloads", (route) => route.fulfill({ json: jobs }));
  await page.goto("/");
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(main.getByRole("link")).toHaveText(["Library", "Ask", "Settings"]);
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Library", exact: true })).toHaveAttribute(
    "data-pressed",
    "",
  );
  await expect(page.getByRole("link", { name: "Downloads", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Downloads", exact: true }).click();
  jobs = [
    {
      ...jobFixture(),
      status: "failed",
      phase: "finished",
      error: "This post has no video. Use a post with exactly one video.",
    },
    { ...jobFixture(), status: "interrupted", phase: "downloading" },
    { ...jobFixture(), status: "cancelled", phase: "finished" },
  ];
  await page.goto("/settings");
  const toRetry = page.getByRole("link", { name: "Downloads, 2 downloads to retry", exact: true });
  await expect(toRetry).toHaveText("2 to retry");
  await toRetry.click();
  await expect(page.getByRole("list", { name: "Recent" })).toContainText("Download failed");
  await main.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("link", { name: "Downloads", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Downloads", exact: true })).toBeVisible();
});

test("removes one download from the list, keeps active ones and clears the rest", async ({
  page,
}) => {
  const running = jobFixture();
  const saved: DownloadJob = {
    ...jobFixture(),
    title: "A saved talk",
    status: "completed",
    phase: "finished",
    mediaId: randomUUID(),
  };
  const failed: DownloadJob = {
    ...jobFixture(),
    title: "A broken post",
    status: "failed",
    phase: "finished",
    error: "This post has no video. Use a post with exactly one video.",
  };
  const cancelled: DownloadJob = {
    ...jobFixture(),
    title: "A cancelled episode",
    status: "cancelled",
    phase: "finished",
  };
  let jobs = [running, saved, failed, cancelled];
  const removed: string[] = [];
  await page.route("**/api/downloads", (route) => {
    if (route.request().method() === "DELETE")
      jobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
    return route.fulfill({ json: jobs });
  });
  await page.route("**/api/downloads/*", (route) => {
    expect(route.request().method()).toBe("DELETE");
    const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    removed.push(id);
    jobs = jobs.filter((job) => job.id !== id);
    return route.fulfill({ json: jobs });
  });
  await page.goto("/downloads");
  const recent = page.getByRole("list", { name: "Recent" });
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });

  await expect(page.getByRole("link", { name: "Open A saved talk", exact: true })).toHaveAttribute(
    "href",
    `/media/${saved.mediaId}`,
  );
  await expect(row("A saved talk").getByRole("button")).toHaveText([""]);
  await row("A saved talk").click({ button: "right", position: { x: 300, y: 10 } });
  await expect(page.getByRole("menuitem", { name: "Remove from list" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.getByRole("button", { name: "More actions for A queued video" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Remove from list" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.getByRole("button", { name: "More actions for A broken post" }).click();
  await page.getByRole("menuitem", { name: "Remove from list" }).click();
  await expect(recent).not.toContainText("A broken post");
  expect(removed).toEqual([failed.id]);
  await expect(row("A cancelled episode").getByRole("link").first()).toBeFocused();

  await page.getByRole("button", { name: "Clear recent downloads", exact: true }).click();
  await expect(recent).toHaveCount(0);
  await expect(page.getByRole("list", { name: "In progress" })).toContainText("A queued video");
  await expect(page.getByRole("button", { name: "Download from link", exact: true })).toBeFocused();
});

for (const choice of [
  { preset: "video-480p", option: "480p", label: "Video · Up to 480p" },
  { preset: "video-720p", option: "720p", label: "Video · Up to 720p" },
  { preset: "video-best", option: "Best", label: "Video · Best available" },
  { preset: "audio", option: "Audio", label: "Audio · Best available" },
] as const) {
  test(`queues ${choice.preset} and shows the selected option after reload`, async ({ page }) => {
    let queued = false;
    const title = "A source recording";
    const job = { ...jobFixture(), preset: choice.preset, title };
    await page.route("**/api/downloads/preview", (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ url });
      return route.fulfill({ json: { url, title, durationSeconds: 2, saved: [] } });
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
    await expect(page.getByRole("link", { name: "YouTube", exact: true })).toHaveAttribute(
      "href",
      url,
    );
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
      json: { url: previewUrl, title: titles[previewUrl], durationSeconds: 90, saved: [] },
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
        : { json: { url: sourceUrl, title: job.title, durationSeconds: null, saved: [] } },
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
  await expect(list.getByText("X", { exact: true })).toBeVisible();
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
  await page.getByRole("link", { name: `Open ${job.title}`, exact: true }).click();
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
      json: {
        url: previewUrl,
        title: `Video ${previewUrl.slice(-11)}`,
        durationSeconds: 60,
        saved: [],
      },
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
