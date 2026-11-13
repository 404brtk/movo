import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../helpers/timed-words.ts";

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
        revision: 0,
        resultRevision: 0,
        device: null,
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
  await expect(panel.getByRole("button", { name: "Copy transcript", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Export transcript", exact: true })).toHaveCount(
    0,
  );
  expect(attempts).toBe(0);
  await panel.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Download Parakeet Ultra");
  await expect(
    panel.getByRole("link", { name: "Download Parakeet Ultra in Models", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Transcribing");
  await expect(panel.getByRole("button", { name: "Export transcript", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  job = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    status: "completed",
    phase: "finished",
    transcript: {
      language: "en",
      words: [
        ...timedWords(100, 800, "First saved passage."),
        ...timedWords(1000, 1800, "Second saved passage."),
      ],
    },
    revision: 0,
    resultRevision: 0,
    device: { backend: "vulkan", name: "Test GPU" },
    error: null,
    cleanupError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expect(panel.getByText("Second saved passage.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Parakeet Ultra", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText("First saved passage.", { exact: true })).toBeVisible();
  const passages = panel.getByRole("list", { name: "Timestamped passages" }).getByRole("listitem");
  const currentPassage = panel.locator('[aria-current="time"]');
  const currentWord = panel.locator("mark");
  await expect(currentPassage).toHaveCount(0);
  await expect(currentWord).toHaveCount(0);
  await panel.getByRole("button", { name: "Go to 0:01", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeCloseTo(1, 1);
  await expect(passages.nth(1)).toHaveAttribute("aria-current", "time");
  await expect(currentPassage).toHaveCount(1);
  await expect(currentWord).toHaveText("Second");
  await expect(passages.nth(1)).toHaveText(/Second saved passage\.$/u);
  await page.locator("audio").evaluate((element: HTMLMediaElement) => {
    element.currentTime = 1.6;
  });
  await expect(currentWord).toHaveText("passage.");
  await panel.getByRole("button", { name: "Go to 0:00", exact: true }).click();
  await expect(passages.nth(0)).toHaveAttribute("aria-current", "time");
  await expect(currentWord).toHaveText("First");
  await expect(currentPassage).toHaveCount(1);
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
    revision: 0,
    resultRevision: 0,
    device: { backend: "vulkan", name: "Test GPU" },
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
  const device = panel.getByText("On Test GPU · Vulkan", { exact: true });
  await expect(panel.getByRole("status")).toContainText("Loading Parakeet Ultra");
  await expect(device).toHaveCount(0);
  await panel.getByRole("button", { name: "Cancel transcription", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Transcription stopped" })).toBeVisible();
  await panel.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Check folder permissions and try again.");
  await panel.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Transcribing");
  await expect(device).toBeVisible();
  job = {
    ...job,
    status: "completed",
    phase: "finished",
    transcript: { language: null, words: [] },
    cleanupError: "Could not remove temporary transcription files. Check folder permissions.",
  };
  await page.reload();
  await expect(
    panel.getByText("No speech was detected in this recording.", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText("temporary transcription files");
  await expect(panel.getByRole("button", { name: "Copy transcript", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Export transcript", exact: true })).toHaveCount(
    0,
  );
  await expect(panel.getByRole("button", { name: "Retry transcription", exact: true })).toHaveCount(
    0,
  );
  await expect(panel.getByRole("button", { name: "History", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const more = page.getByRole("button", { name: "More actions", exact: true });
  const removeSavedCopy = page.getByRole("menuitem", { name: /^Remove saved copy/u });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Transcribe again", exact: true })).toBeVisible();
  await expect(removeSavedCopy).toHaveCount(0);
  await page.keyboard.press("Escape");

  job = { ...job, revision: 1 };
  await page.reload();
  await expect(
    panel.getByText("Every passage was removed. Restore an earlier version from History.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "History", exact: true })).toBeVisible();
  await more.click();
  await expect(removeSavedCopy).toBeVisible();
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
    revision: 0,
    resultRevision: 0,
    device: null,
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
      words: [...timedWords(0, 1000, "The retried transcription completed.")],
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

test("transcribes a completed recording again while keeping the previous transcript readable", async ({
  page,
  request,
}) => {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.wav` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  const previous = {
    language: "en",
    words: timedWords(0, 1000, "The previous transcript."),
  };
  let job: TranscriptionJob = {
    mediaId: media.id,
    modelId: "parakeet-ultra-q8",
    status: "completed",
    phase: "finished",
    transcript: previous,
    revision: 0,
    resultRevision: 0,
    device: { backend: "cpu", name: "Test CPU" },
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
  await page.route(`**/api/media/${media.id}/transcription/retry`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    retries++;
    job = { ...job, status: "running", phase: "transcribing", device: null, error: null };
    return route.fulfill({ status: 202, json: job });
  });
  await page.addInitScript(() => {
    let writes = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          if (++writes === 2)
            await new Promise((resolve) => {
              window.addEventListener("release-copy", resolve, { once: true });
            });
        },
      },
    });
  });
  await page.goto(`/media/${media.id}`);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  const previousText = panel.getByText("The previous transcript.", { exact: true });
  const notice = panel.getByText(/^Showing the previous transcript/u);
  await expect(previousText).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Retry transcription", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Transcribe again", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Transcribing" })).toBeVisible();
  await expect(previousText).toBeVisible();
  await expect(notice).toBeVisible();
  await expect(panel.getByRole("button", { name: "Copy transcript", exact: true })).toBeVisible();
  await page.reload();
  await expect(previousText).toBeVisible();
  await expect(notice).toBeVisible();
  job = { ...job, status: "failed", phase: "finished", error: "The new attempt failed." };
  await expect(panel.getByRole("alert")).toContainText("The new attempt failed.");
  await expect(previousText).toBeVisible();
  await expect(notice).toBeVisible();
  const copyButton = panel.getByRole("button", { name: "Copy transcript", exact: true });
  const copied = panel.getByText("Transcript copied.", { exact: true });
  await copyButton.click();
  await expect(copied).toBeVisible();
  await copyButton.click();
  await expect(copyButton).toBeDisabled();
  await panel.getByRole("button", { name: "Retry transcription", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Transcribing" })).toBeVisible();
  job = {
    ...job,
    status: "completed",
    phase: "finished",
    transcript: {
      language: "en",
      words: timedWords(0, 1000, "The replacement transcript."),
    },
    revision: 0,
    resultRevision: 0,
    device: { backend: "vulkan", name: "Test GPU" },
  };
  await expect(panel.getByText("The replacement transcript.", { exact: true })).toBeVisible();
  await expect(previousText).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await expect(copied).toHaveCount(0);
  await copyButton.click();
  await expect(copied).toBeVisible();
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("release-copy"));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await expect(copied).toBeVisible();
  expect(retries).toBe(2);
});

test("offers transcribing again after a cancelled, rejected or failed repeat attempt", async ({
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
    status: "cancelled",
    phase: "finished",
    transcript: { language: "en", words: timedWords(0, 1000, "The previous transcript.") },
    revision: 0,
    resultRevision: 0,
    device: null,
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
  await page.route(`**/api/media/${media.id}/transcription/retry`, (route) => {
    expect(route.request().method()).toBe("POST");
    if (++retries === 1)
      return route.fulfill({
        status: 500,
        json: { error: "Close apps using the recording and try again." },
      });
    job = { ...job, status: "running", phase: "transcribing", error: null };
    return route.fulfill({ status: 202, json: job });
  });
  await page.goto(`/media/${media.id}`);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  await expect(panel.getByText("Showing the previous transcript.", { exact: true })).toBeVisible();
  const more = page.getByRole("button", { name: "More actions", exact: true });
  const transcribeAgain = page.getByRole("menuitem", { name: "Transcribe again", exact: true });
  await more.click();
  await transcribeAgain.click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Close apps using the recording and try again.",
  );
  await more.click();
  await transcribeAgain.click();
  await expect(panel.getByRole("status").filter({ hasText: "Transcribing" })).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);

  job = {
    ...job,
    status: "failed",
    phase: "finished",
    revision: 1,
    error: "The new attempt failed.",
  };
  await expect(panel.getByRole("alert")).toContainText("The new attempt failed.");
  await panel.getByRole("button", { name: "Retry transcription", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace your edits?" });
  await dialog.getByRole("button", { name: "Keep edits" }).click();
  await expect(dialog).toBeHidden();
  expect(retries).toBe(2);
  await panel.getByRole("button", { name: "Retry transcription", exact: true }).click();
  await dialog.getByRole("button", { name: "Transcribe again" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole("status").filter({ hasText: "Transcribing" })).toBeVisible();
  expect(retries).toBe(3);
});
