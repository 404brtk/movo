import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { MediaToolsStatus } from "../../src/shared/contracts/media-tools.ts";

const initial: MediaToolsStatus = {
  ffprobe: { state: "missing" },
  ffmpeg: { state: "missing" },
  download: {
    provider: "Gyan",
    sourceUrl: "https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2",
    version: "9.0.2",
    bytes: 114768076,
  },
  installation: { phase: "idle", downloadedBytes: 0, error: null },
};

test("offers explicit setup, retries a failed request and keeps progress after reload before importing", async ({
  page,
}) => {
  let status = initial;
  let downloads = 0;
  let imports = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/media" && request.method() === "POST") imports++;
  });
  await page.route("**/api/media-tools", (route) => route.fulfill({ json: status }));
  await page.route("**/api/media-tools/install", async (route) => {
    downloads++;
    if (downloads === 1)
      await route.fulfill({
        status: 503,
        json: { error: "Could not start the download. Try again." },
      });
    else {
      status = {
        ...initial,
        installation: { phase: "downloading", downloadedBytes: 1024, error: null },
      };
      await route.fulfill({ status: 202, json: status });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Media tools are needed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download media tools", exact: true }),
  ).toBeVisible();
  expect(downloads).toBe(0);
  expect(imports).toBe(0);
  await page.getByRole("button", { name: "Download media tools", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not start the download");
  await page.getByRole("button", { name: "Retry download", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Downloading media tools" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Downloading media tools" })).toBeVisible();
  expect(downloads).toBe(2);
  status = {
    ...initial,
    ffprobe: { state: "ready", source: "managed", version: "9.0.2" },
    ffmpeg: { state: "ready", source: "managed", version: "9.0.2" },
    installation: { phase: "complete", downloadedBytes: initial.download?.bytes ?? 0, error: null },
  };
  await expect(
    page.getByRole("heading", { name: "Media tools are ready", exact: true }),
  ).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Import files" });
  await page
    .getByRole("region", { name: "Media tools are ready" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(dialog.getByRole("button", { name: "Choose files", exact: true })).toBeFocused();
  const chooserPromise = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Choose files", exact: true }).click();
  const chooser = await chooserPromise;
  const title = `Tools ready ${randomUUID()}`;
  await chooser.setFiles({
    name: `${title}.wav`,
    mimeType: "audio/wav",
    buffer: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
  });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toBeVisible({
    timeout: 15000,
  });
  expect(imports).toBe(1);
});

test("checks tools again before uploading when an executable disappears", async ({ page }) => {
  let status: MediaToolsStatus = {
    ...initial,
    ffprobe: { state: "ready", source: "system", version: "9.0.2" },
  };
  let imports = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/media" && request.method() === "POST") imports++;
  });
  await page.route("**/api/media-tools", (route) => route.fulfill({ json: status }));
  await page.goto("/");
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import files" });
  await dialog.getByLabel("Choose media files").setInputFiles({
    name: "not-uploaded.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("file bytes"),
  });
  await expect(
    page.getByRole("heading", { name: "Media tools are needed", exact: true }),
  ).toHaveCount(0);
  status = initial;
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Media tools are needed", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Files to import" })).toContainText(
    "not-uploaded.wav",
  );
  expect(imports).toBe(0);
});

test("offers the tools setup when transcribing after import needs FFmpeg", async ({ page }) => {
  const status: MediaToolsStatus = {
    ...initial,
    ffprobe: { state: "ready", source: "system", version: "9.0.2" },
  };
  let imports = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/media" && request.method() === "POST") imports++;
  });
  await page.route("**/api/media-tools", (route) => route.fulfill({ json: status }));
  await page.goto("/");
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import files" });
  const title = `Without FFmpeg ${randomUUID()}`;
  await dialog.getByLabel("Choose media files").setInputFiles({
    name: `${title}.wav`,
    mimeType: "audio/wav",
    buffer: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
  });
  const transcribe = dialog.getByRole("switch", { name: "Transcribe after import" });
  await transcribe.click();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Download media tools", exact: true }),
  ).toBeVisible();
  expect(imports).toBe(0);
  await transcribe.click();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toBeVisible();
  expect(imports).toBe(1);
});

test("cancels an import while its tools check is still waiting", async ({ page }) => {
  const status: MediaToolsStatus = {
    ...initial,
    ffprobe: { state: "ready", source: "system", version: "9.0.2" },
  };
  let checks = 0;
  let imports = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/media" && request.method() === "POST") imports++;
  });
  await page.route("**/api/media-tools", (route) => {
    checks++;
    return checks === 1 ? route.fulfill({ json: status }) : undefined;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import files" });
  await dialog.getByLabel("Choose media files").setInputFiles({
    name: "waiting.wav",
    mimeType: "audio/wav",
    buffer: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
  });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Importing…", exact: true })).toBeDisabled();
  await expect.poll(() => checks).toBeGreaterThan(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("list", { name: "Files to import" })).toContainText("waiting.wav");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(imports).toBe(0);
});

test("shows actionable configuration errors and supports keyboard access", async ({ page }) => {
  const status: MediaToolsStatus = {
    ...initial,
    ffprobe: {
      state: "broken",
      source: "configured",
      message: "ffprobe could not run. Correct or remove FFPROBE_PATH and restart Movo.",
    },
  };
  await page.route("**/api/media-tools", (route) => route.fulfill({ json: status }));
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Import files", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Correct or remove FFPROBE_PATH/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download media tools", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Not now", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Media tools are needed", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose files", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});
