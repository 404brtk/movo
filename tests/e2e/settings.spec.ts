import { expect, test } from "@playwright/test";
import type { ModelCatalog, ModelStatus } from "../../src/shared/contracts/models.ts";

const initial: ModelStatus = {
  id: "parakeet-ultra-q8",
  role: "transcription",
  name: "Parakeet Ultra",
  description: "Local transcription for European languages.",
  bytes: 740363168,
  parts: [{ name: "Parakeet Ultra Q8_0", bytes: 740363168 }],
  sourceUrl: "https://huggingface.co/handy-computer/parakeet-ultra-gguf",
  license: "CC BY 4.0",
  languages: ["en", "pl"],
  state: "missing",
  message: null,
  installation: { phase: "idle", downloadedBytes: 0, error: null },
};
const catalog = (...models: ModelStatus[]): ModelCatalog => ({ models, speakerModelId: null });
const speakerModel = {
  role: "speakers",
  languages: ["en"],
  state: "missing",
  message: null,
  installation: { phase: "idle", downloadedBytes: 0, error: null },
} as const;
const sortformer: ModelStatus = {
  ...speakerModel,
  id: "sortformer-4spk-q8",
  name: "Sortformer",
  description: "GPU or CPU",
  bytes: 139310336,
  parts: [{ name: "Streaming Sortformer 4spk v2.1 Q8_0", bytes: 139310336 }],
  sourceUrl: "https://huggingface.co/handy-computer/diar_streaming_sortformer_4spk-v2.1-gguf",
  license: "NVIDIA Open Model License",
  maxSpeakers: 4,
  state: "ready",
};
const pyannoteModel: ModelStatus = {
  ...speakerModel,
  id: "pyannote-wespeaker",
  name: "Pyannote",
  description: "CPU only",
  bytes: 32523463,
  parts: [
    { name: "Pyannote segmentation 3.0", bytes: 5992913 },
    { name: "WeSpeaker ResNet34-LM", bytes: 26530550 },
  ],
  sourceUrl: "https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html",
  license: "MIT and CC BY 4.0",
  maxSpeakers: 32,
};

test("opens the real model catalog without starting installation", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/models") && request.method() !== "GET")
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const transcription = page.getByRole("listitem", { name: "Parakeet Ultra", exact: true });
  const speakers = page.getByRole("listitem", { name: "Speaker labels", exact: true });
  await expect(
    transcription.getByRole("button", { name: "Download model", exact: true }),
  ).toBeEnabled();
  await expect(transcription.getByText("Not installed", { exact: true })).toBeVisible();
  await expect(transcription).toContainText("Download it once to transcribe on this computer.");
  const labels = speakers.getByRole("radiogroup", { name: "Speaker labels", exact: true });
  await expect(labels.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
  for (const [option, model] of [
    ["Up to 4 speakers", "Sortformer"],
    ["Up to 32 speakers", "Pyannote"],
  ] as const) {
    await expect(labels.getByRole("radio", { name: option, exact: true })).toBeDisabled();
    await expect(speakers.getByText(model, { exact: true })).toBeVisible();
    await expect(
      speakers.getByRole("button", { name: `Download ${model}`, exact: true }),
    ).toBeEnabled();
  }
  await expect(speakers.getByText("Not installed", { exact: true })).toHaveCount(2);
  await expect(
    page
      .getByRole("listitem", { name: "Dictionary", exact: true })
      .getByRole("button", { name: "Manage", exact: true }),
  ).toBeEnabled();
  const details = speakers.getByRole("button", { name: "Up to 32 speakers details", exact: true });
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(0, 0);
  await expect
    .poll(() => details.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  await expect(speakers.getByText("MIT and CC BY 4.0", { exact: true })).toBeVisible();
  await expect(speakers.getByRole("listitem").filter({ hasText: "segmentation" })).toHaveText(
    "Pyannote segmentation 3.0 · 5.7 MiB",
  );
  await expect(speakers.getByRole("listitem").filter({ hasText: "WeSpeaker" })).toHaveText(
    "WeSpeaker ResNet34-LM · 25.3 MiB",
  );
  await expect(speakers.getByText("English", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("requires an explicit download, retries a failed request and discovers installation after navigation and reload", async ({
  page,
}) => {
  let model = initial;
  let attempts = 0;
  await page.route("**/api/models", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: catalog(model) });
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
  await page.goto("/settings");
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
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
  const repairMessage =
    "The cached file parakeet-ultra-Q8_0.gguf failed its SHA-256 integrity check. Repair it in your Hugging Face cache, then check again.";
  model = {
    ...model,
    state: "broken",
    message: repairMessage,
    installation: { phase: "failed", downloadedBytes: 0, error: "The download was interrupted." },
  };
  await page.getByRole("button", { name: "Parakeet Ultra details", exact: true }).click();
  await expect(
    page.getByText("Verified in your Hugging Face cache", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Needs repair", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Download model", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(repairMessage);
  await expect(page.getByRole("status")).toHaveText("Needs repair");
});

test("cancels verification and reports a failed verification with an explicit retry on a narrow screen", async ({
  page,
}, testInfo) => {
  let model: ModelStatus = {
    ...initial,
    installation: { phase: "verifying", downloadedBytes: initial.bytes, error: null },
  };
  await page.route("**/api/models", (route) => route.fulfill({ json: catalog(model) }));
  await page.route(`**/api/models/${initial.id}/cancel`, async (route) => {
    expect(route.request().method()).toBe("POST");
    model = {
      ...initial,
      installation: { phase: "cancelled", downloadedBytes: initial.bytes, error: null },
    };
    await route.fulfill({ json: model });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
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
  await page.getByRole("button", { name: "Parakeet Ultra details", exact: true }).click();
  await expect(page.getByText("English, Polish", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("settings-mobile.png"), fullPage: true });
});

test("chooses speaker labels, uses a speaker model once its download completes and keeps the choice after a rejected change", async ({
  page,
}, testInfo) => {
  let pyannote = pyannoteModel;
  let current: ModelCatalog = {
    models: [{ ...initial, state: "ready" }, sortformer, pyannote],
    speakerModelId: "sortformer-4spk-q8",
  };
  const choices: unknown[] = [];
  let rejectChoice = false;
  await page.route("**/api/models", (route) => route.fulfill({ json: current }));
  await page.route("**/api/models/speaker-labels", async (route) => {
    expect(route.request().method()).toBe("PUT");
    const choice = route.request().postDataJSON();
    choices.push(choice);
    if (rejectChoice)
      return route.fulfill({
        status: 400,
        json: { error: "Download Sortformer before using it for speaker labels." },
      });
    current = { ...current, ...choice };
    return route.fulfill({ json: choice });
  });
  await page.route(`**/api/models/${pyannote.id}/install`, async (route) => {
    expect(route.request().method()).toBe("POST");
    pyannote = {
      ...pyannote,
      installation: { phase: "downloading", downloadedBytes: 8 * 1024 * 1024, error: null },
    };
    current = { ...current, models: [current.models[0] ?? initial, sortformer, pyannote] };
    await route.fulfill({ status: 202, json: pyannote });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const labels = page.getByRole("radiogroup", { name: "Speaker labels", exact: true });
  const off = labels.getByRole("radio", { name: "Off", exact: true });
  const upToFour = labels.getByRole("radio", { name: "Up to 4 speakers", exact: true });
  const upToThirtyTwo = labels.getByRole("radio", { name: "Up to 32 speakers", exact: true });
  await expect(upToFour).toBeChecked();
  await expect(upToFour).toHaveAccessibleDescription("Sortformer · GPU or CPU · 132.9 MiB");
  await expect(upToThirtyTwo).toBeDisabled();
  const speakers = page.getByRole("listitem", { name: "Speaker labels", exact: true });
  await expect(speakers.getByRole("status")).toHaveText(["Installed", "Not installed"]);
  await page.getByText("Off", { exact: true }).click();
  await expect(off).toBeChecked();
  await upToFour.click();
  await expect(upToFour).toBeChecked();
  await page.getByRole("button", { name: "Download Pyannote", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "Up to 32 speakers download", exact: true }),
  ).toHaveAttribute("aria-valuenow", String(8 * 1024 * 1024));
  await expect(
    page.getByText(
      "New transcripts use it once the download is verified. You can keep using Movo.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(upToFour).toBeChecked();
  pyannote = {
    ...pyannote,
    state: "ready",
    installation: { phase: "complete", downloadedBytes: pyannote.bytes, error: null },
  };
  current = {
    models: [current.models[0] ?? initial, sortformer, pyannote],
    speakerModelId: "pyannote-wespeaker",
  };
  await expect(upToThirtyTwo).toBeChecked();
  await expect(upToThirtyTwo).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("speaker-labels-mobile.png"), fullPage: true });
  rejectChoice = true;
  await upToFour.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("alert")).toHaveText(
    "Download Sortformer before using it for speaker labels.",
  );
  await expect(upToThirtyTwo).toBeChecked();
  expect(choices).toEqual([
    { speakerModelId: null },
    { speakerModelId: "sortformer-4spk-q8" },
    { speakerModelId: "sortformer-4spk-q8" },
  ]);
});

test("keeps showing the latest speaker labels choice until it is saved, through an earlier rejection and catalog refreshes", async ({
  page,
}) => {
  let current: ModelCatalog = {
    models: [
      { ...initial, installation: { phase: "downloading", downloadedBytes: 1024, error: null } },
      sortformer,
      { ...pyannoteModel, state: "ready" },
    ],
    speakerModelId: "sortformer-4spk-q8",
  };
  let catalogReads = 0;
  const choices: unknown[] = [];
  const held: (() => void)[] = [];
  await page.route("**/api/models", (route) => {
    catalogReads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/models/speaker-labels", async (route) => {
    const choice = route.request().postDataJSON();
    choices.push(choice);
    await new Promise<void>((resolve) => held.push(resolve));
    if (choice.speakerModelId !== null)
      return route.fulfill({ status: 400, json: { error: "The cached model needs repair." } });
    current = { ...current, ...choice };
    return route.fulfill({ json: choice });
  });
  await page.goto("/settings");
  const labels = page.getByRole("radiogroup", { name: "Speaker labels", exact: true });
  const off = labels.getByRole("radio", { name: "Off", exact: true });
  await expect(labels.getByRole("radio", { name: "Up to 4 speakers", exact: true })).toBeChecked();
  await labels.getByRole("radio", { name: "Up to 32 speakers", exact: true }).click();
  await expect.poll(() => choices).toHaveLength(1);
  await off.click();
  held.shift()?.();
  await expect.poll(() => choices).toHaveLength(2);
  const readsBeforeRefresh = catalogReads;
  await expect.poll(() => catalogReads).toBeGreaterThan(readsBeforeRefresh);
  await expect(off).toBeChecked();
  held.shift()?.();
  await expect.poll(() => current.speakerModelId).toBeNull();
  await page.reload();
  await expect(off).toBeChecked();
});

test("lists the media tools and opens yt-dlp setup from the settings page", async ({ page }) => {
  await page.route("**/api/models", (route) => route.fulfill({ json: catalog(initial) }));
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
  await page.goto("/settings");
  const tools = page.getByRole("region", { name: "Adding recordings" });
  await expect(tools.getByRole("listitem").first()).toContainText(
    "Reads files and prepares audio · FFprobe 7.1 and FFmpeg 7.1 · private copy",
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
