import { expect, test } from "@playwright/test";
import type { YtdlpStatus } from "../../src/shared/contracts/media-tools.ts";

const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const missing: YtdlpStatus = {
  ytdlp: { state: "missing" },
  download: {
    provider: "yt-dlp",
    sourceUrl: "https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26",
    version: "2026.10.26",
    bytes: 23575744,
  },
  installation: { phase: "idle", downloadedBytes: 0, error: null },
};

test("installs yt-dlp before checking a link and returns focus after setup", async ({ page }) => {
  let status = missing;
  let previews = 0;
  await page.route("**/api/ytdlp", (route) => route.fulfill({ json: status }));
  await page.route("**/api/ytdlp/install", async (route) => {
    expect(route.request().method()).toBe("POST");
    status = {
      ...missing,
      installation: { phase: "downloading", downloadedBytes: 1024, error: null },
    };
    await route.fulfill({ status: 202, json: status });
  });
  await page.route("**/api/downloads/preview", async (route) => {
    previews++;
    await route.fulfill({ json: { url, title: "A source recording", durationSeconds: 2 } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const links = page.getByRole("textbox", { name: "Add links" });
  await links.fill(url);
  await links.press("Enter");
  await expect(page.getByRole("heading", { name: "yt-dlp is needed", exact: true })).toBeVisible();
  expect(previews).toBe(0);
  await page.getByRole("button", { name: "Download yt-dlp", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Downloading yt-dlp" })).toBeVisible();
  status = {
    ...missing,
    ytdlp: { state: "ready", source: "managed", version: "2026.10.26" },
    installation: { phase: "complete", downloadedBytes: missing.download?.bytes ?? 0, error: null },
  };
  await expect(page.getByRole("heading", { name: "yt-dlp is ready", exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "yt-dlp is ready" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "yt-dlp is ready" })).toHaveCount(0);
  await expect(links).toBeFocused();
  await expect(page.getByText("A source recording", { exact: true })).toBeVisible();
  expect(previews).toBe(1);
});

test("explains manual yt-dlp setup where automatic downloads are unavailable", async ({ page }) => {
  await page.route("**/api/ytdlp", (route) =>
    route.fulfill({ json: { ...missing, download: null } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Download from link", exact: true }).click();
  const links = page.getByRole("textbox", { name: "Add links" });
  await links.fill(url);
  await links.press("Enter");
  await expect(page.getByText(/add it to PATH or set YTDLP_PATH/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download yt-dlp", exact: true })).toHaveCount(0);
});
