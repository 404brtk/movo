import { expect, test } from "@playwright/test";

test("starts without model weights and connects to the local service", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("movo");
  await expect(page.getByRole("heading", { name: "movo", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Local service connected.");
  expect(pageErrors).toEqual([]);
});

test("keeps missing API routes separate from the single-page fallback", async ({ request }) => {
  const response = await request.get("/api/missing");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "Not found" });
});

test("serves the client router on a direct navigation to an unknown page", async ({ page }) => {
  await page.goto("/missing");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Return home" }).click();
  await expect(page.getByRole("status")).toHaveText("Local service connected.");
});
