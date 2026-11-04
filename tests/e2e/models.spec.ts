import { expect, test } from "@playwright/test";
import type { ModelStatus } from "../../src/shared/contracts/models.ts";

const initial: ModelStatus = {
  id: "parakeet-ultra-q8",
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
  await expect(page.getByRole("heading", { name: "Parakeet Ultra", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download model", exact: true })).toBeEnabled();
  await expect(page.getByText("Not installed", { exact: true })).toBeVisible();
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
    "value",
    "1024",
  );
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
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
  await expect(page.getByRole("status")).toHaveText("");
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
  await page.getByRole("button", { name: "Cancel installation", exact: true }).click();
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
  await page.getByText("Supported languages (2)", { exact: true }).click();
  await expect(page.getByText("English, Polish", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("models-mobile.png"), fullPage: true });
});
