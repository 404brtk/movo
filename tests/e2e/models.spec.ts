import { expect, test } from "@playwright/test";
import type { ModelStatus } from "../../src/shared/contracts/models.ts";

const initial: ModelStatus = {
  id: "parakeet-ultra-q8",
  role: "transcription",
  name: "Parakeet Ultra",
  description: "Local transcription for European languages.",
  bytes: 740363168,
  sourceUrl: "https://huggingface.co/handy-computer/parakeet-ultra-gguf",
  license: "CC BY 4.0",
  languages: ["en", "pl"],
  state: "missing",
  message: null,
  installation: { phase: "idle", downloadedBytes: 0, error: null },
};

test("opens the real model catalog without starting installation", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/models") && request.method() !== "GET")
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  const transcription = page.getByRole("region", { name: "Parakeet Ultra", exact: true });
  const speakers = page.getByRole("region", { name: "Sortformer Speakers", exact: true });
  for (const card of [transcription, speakers]) {
    await expect(card.getByRole("button", { name: "Download model", exact: true })).toBeEnabled();
    await expect(card.getByText("Not installed", { exact: true })).toBeVisible();
  }
  await expect(transcription).toContainText("Download it once to transcribe on this computer.");
  await expect(speakers).toContainText(
    "Optional. Download it to label who speaks in new transcripts.",
  );
  await expect(speakers).toContainText("1 language");
  expect(writes).toEqual([]);
});

test("requires an explicit download, retries a failed request and discovers installation after navigation and reload", async ({
  page,
}) => {
  let model = initial;
  let attempts = 0;
  await page.route("**/api/models", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: [model] });
  });
  await page.route(`**/api/models/${initial.id}/install`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        json: { error: "Could not start the model download. Try again." },
      });
    else {
      model = {
        ...model,
        installation: { phase: "downloading", downloadedBytes: 1024, error: null },
      };
      await route.fulfill({ status: 202, json: model });
    }
  });
  await page.goto("/models");
  await expect(page.getByRole("button", { name: "Download model", exact: true })).toBeEnabled();
  expect(attempts).toBe(0);
  await page.getByRole("button", { name: "Download model", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not start the model download. Try again.",
  );
  await page.getByRole("button", { name: "Download model", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Parakeet Ultra download" })).toHaveAttribute(
    "aria-valuenow",
    "1024",
  );
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Library", exact: true })
    .click();
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Parakeet Ultra download" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Parakeet Ultra download" })).toBeVisible();
  model = {
    ...model,
    state: "ready",
    installation: { phase: "complete", downloadedBytes: model.bytes, error: null },
  };
  await expect(page.getByText("Installed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download model", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Installed", { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  model = {
    ...model,
    state: "broken",
    message:
      "The cached model failed its SHA-256 integrity check. Repair it in your Hugging Face cache, then check again.",
  };
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Needs repair", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download model", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Repair it in your Hugging Face cache");
  await expect(page.getByRole("status")).toHaveText("Needs repair");
});

test("cancels verification and reports a failed verification with an explicit retry on a narrow screen", async ({
  page,
}, testInfo) => {
  let model: ModelStatus = {
    ...initial,
    installation: { phase: "verifying", downloadedBytes: initial.bytes, error: null },
  };
  await page.route("**/api/models", (route) => route.fulfill({ json: [model] }));
  await page.route(`**/api/models/${initial.id}/cancel`, async (route) => {
    expect(route.request().method()).toBe("POST");
    model = {
      ...initial,
      installation: { phase: "cancelled", downloadedBytes: initial.bytes, error: null },
    };
    await route.fulfill({ json: model });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/models");
  await expect(page.getByRole("status")).toHaveText("Verifying download…");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Download cancelled.");
  await expect(page.getByRole("button", { name: "Download model", exact: true })).toBeEnabled();
  model = {
    ...initial,
    installation: {
      phase: "failed",
      downloadedBytes: initial.bytes,
      error: "The model failed its integrity check.",
    },
  };
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText("The model failed its integrity check.");
  await expect(page.getByRole("button", { name: "Retry download", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Supported languages", exact: true }).click();
  await expect(page.getByText("English, Polish", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("models-mobile.png"), fullPage: true });
});

test("lists the media tools and opens yt-dlp setup from the models page", async ({ page }) => {
  await page.route("**/api/models", (route) => route.fulfill({ json: [initial] }));
  await page.route("**/api/media-tools", (route) =>
    route.fulfill({
      json: {
        ffprobe: { state: "ready", source: "managed", version: "7.1-essentials_build" },
        ffmpeg: { state: "ready", source: "managed", version: "7.1-essentials_build" },
        download: null,
        installation: { phase: "idle", downloadedBytes: 0, error: null },
      },
    }),
  );
  let ytdlpChecks = 0;
  await page.route("**/api/ytdlp", (route) =>
    ++ytdlpChecks === 1
      ? route.fulfill({ status: 500, json: { error: "Could not check yt-dlp." } })
      : route.fulfill({
          json: {
            ytdlp: { state: "missing" },
            download: {
              provider: "yt-dlp",
              sourceUrl: "https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26",
              version: "2026.10.26",
              bytes: 18874368,
            },
            installation: { phase: "idle", downloadedBytes: 0, error: null },
          },
        }),
  );
  await page.goto("/models");
  const tools = page.getByRole("list", { name: "Tools" });
  await expect(tools.getByRole("listitem").first()).toContainText(
    "FFprobe 7.1 and FFmpeg 7.1 · private copy",
  );
  await expect(tools.getByText("Ready", { exact: true })).toBeVisible();
  await expect(tools.getByRole("alert")).toHaveText("Could not check yt-dlp.");
  await tools.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(tools.getByRole("alert")).toHaveCount(0);
  await tools.getByRole("button", { name: "Download yt-dlp", exact: true }).click();
  await expect(page.getByRole("heading", { name: "yt-dlp is needed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "yt-dlp is needed", exact: true })).toHaveCount(0);
});
