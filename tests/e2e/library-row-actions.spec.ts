import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { LibraryItem } from "../../src/shared/contracts/library.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../helpers/timed-words.ts";

const wave = readFileSync(resolve("tests/fixtures/tone.wav"));
const libraryList = /\/api\/media(\?.*)?$/u;

const listed = (
  title: string,
  transcription: LibraryItem["transcription"],
  overrides: Partial<LibraryItem> = {},
): LibraryItem => ({
  id: randomUUID(),
  title,
  originalName: `${title}.wav`,
  kind: "audio",
  contentType: "audio/wav",
  byteSize: 1000,
  durationSeconds: 2,
  importedAt: Date.now(),
  sourceUrl: null,
  fileRemovedAt: null,
  transcription,
  ...overrides,
});

const completedJob = (mediaId: string, text: string): TranscriptionJob => ({
  mediaId,
  modelId: "parakeet-ultra-q8",
  status: "completed",
  phase: "finished",
  transcript: { language: "en", words: timedWords(0, 1800, text) },
  revision: 0,
  resultRevision: 0,
  device: { backend: "cpu", name: "Test CPU" },
  error: null,
  cleanupError: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

async function serveLibrary(page: Page, items: LibraryItem[]) {
  const library = { items };
  await page.route(libraryList, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({ json: { items: library.items, transcribing: false } });
  });
  await page.route("**/api/media/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const item = library.items.find((entry) => entry.id === id);
    if (!item) return route.fulfill({ status: 404, json: { error: "Not found." } });
    if (route.request().method() !== "DELETE") return route.fulfill({ json: item });
    if (item.transcription === "active")
      return route.fulfill({
        status: 409,
        json: { error: "Cancel the transcription before deleting this recording." },
      });
    library.items = library.items.filter((entry) => entry.id !== id);
    return route.fulfill({ json: item });
  });
  await page.route("**/api/media/*/transcription", (route) =>
    route.fulfill({ status: 404, json: { error: "Not transcribed." } }),
  );
  return library;
}

const row = (page: Page, title: string) =>
  page.getByRole("link", { name: `Open ${title}`, exact: true });

test("renames a recording in place from its row, recovers from a rejected title and keeps it after reload", async ({
  page,
}) => {
  const title = `Inline ${randomUUID()}`;
  const renamed = `Rozmowa ${randomUUID()}`;
  const blurred = `Blurred ${randomUUID()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Import files" });
  await importDialog
    .getByLabel("Choose media files")
    .setInputFiles({ name: `${title}.wav`, mimeType: "audio/wav", buffer: wave });
  await importDialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(row(page, title)).toBeVisible();
  await page.keyboard.press("Escape");

  await row(page, title).hover();
  await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename recording" }).click();
  const field = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(title);
  await field.fill("unsaved");
  await field.press("Escape");
  await expect(row(page, title)).toBeFocused();

  await page.keyboard.press("F2");
  await expect(field).toBeFocused();
  await field.fill(`  ${renamed}  `);
  let rejected = false;
  await page.route("**/api/media/*", async (route) => {
    if (route.request().method() !== "PATCH" || rejected) return route.fallback();
    rejected = true;
    expect(route.request().postDataJSON()).toEqual({ title: renamed });
    await route.fulfill({ status: 500, json: { error: "Could not save this title." } });
  });
  await field.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Could not save this title.");
  await expect(field).toHaveValue(`  ${renamed}  `);
  await expect(field).toBeFocused();
  await field.press("Enter");
  await expect(row(page, renamed)).toBeFocused();
  await expect(row(page, title)).toHaveCount(0);

  await page.keyboard.press("F2");
  await field.fill(blurred);
  await page.getByRole("heading", { name: "Library", exact: true }).click();
  await expect(row(page, blurred)).toBeVisible();
  await page.reload();
  await expect(row(page, blurred)).toBeVisible();
  await row(page, blurred).focus();
  await page.keyboard.press("F2");
  await field.fill("   ");
  await field.press("Enter");
  await expect(row(page, blurred)).toBeFocused();
  await page.keyboard.press("F2");
  await field.fill("");
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(row(page, blurred)).toBeFocused();
});

test("opens the row menu with a right click, moves between rows with arrows and deletes with focus on the next row", async ({
  page,
}) => {
  const [first, second, third] = [
    listed("First notes", "none"),
    listed("Second notes", "none", { sourceUrl: "https://www.youtube.com/watch?v=abc" }),
    listed("Third notes", "none"),
  ];
  const library = await serveLibrary(page, [first, second, third]);
  await page.goto("/");

  await row(page, second.title).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    /Rename recording/u,
    "Save a copy",
    "View original source",
    "Select",
    /Delete recording…/u,
  ]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/u);

  await row(page, first.title).focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, second.title)).toBeFocused();
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Delete “${second.title}”?`);
  await page.keyboard.press("Escape");
  await expect(row(page, second.title)).toBeFocused();

  await page.keyboard.press("Delete");
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(row(page, second.title)).toHaveCount(0);
  await expect(row(page, third.title)).toBeFocused();
  expect(library.items.map((item) => item.title)).toEqual([first.title, third.title]);
  await page.keyboard.press("ArrowUp");
  await expect(row(page, first.title)).toBeFocused();
});

test("copies and exports a transcript from the row menu", async ({ page }) => {
  await page.addInitScript(() => {
    let text = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          text = value;
        },
        readText: async () => text,
      },
    });
  });
  const done = listed("Transcribed notes", "done");
  const silent = listed("Silent notes", "done");
  await serveLibrary(page, [done, silent]);
  await page.route(`**/api/media/${done.id}/transcription`, (route) =>
    route.fulfill({ json: completedJob(done.id, "The library keeps every word.") }),
  );
  await page.route(`**/api/media/${silent.id}/transcription`, (route) =>
    route.fulfill({ json: completedJob(silent.id, "") }),
  );
  await page.goto("/");

  await row(page, done.title).hover();
  await page.getByRole("button", { name: `More actions for ${done.title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy transcript" }).click();
  await expect(page.getByText("Transcript copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "The library keeps every word.",
  );

  await page.getByRole("button", { name: `More actions for ${done.title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Export transcript" }).hover();
  await expect(page.getByRole("menuitem", { name: /^Download SRT/u })).toHaveAttribute(
    "href",
    `/api/media/${done.id}/transcription/export/srt`,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await row(page, silent.title).hover();
  await page.getByRole("button", { name: `More actions for ${silent.title}`, exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Transcribe again" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy transcript" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Remove saved copy…" })).toHaveCount(0);
});

test("selects a range, transcribes the eligible recordings and reports a partial deletion", async ({
  page,
}) => {
  const items = [
    listed("Alpha", "none"),
    listed("Bravo", "stopped"),
    listed("Charlie", "done"),
    listed("Delta", "active"),
  ];
  const [alpha, bravo, charlie, delta] = items;
  const library = await serveLibrary(page, items);
  const started: string[] = [];
  await page.route(/\/api\/media\/[^/]+\/transcription(\/retry)?$/u, (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ status: 404, json: { error: "Not transcribed." } });
    const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    started.push(`${id}:${route.request().url().endsWith("/retry") ? "retry" : "start"}`);
    return route.fulfill({
      status: 202,
      json: { ...completedJob(id, "queued"), status: "queued", phase: "queued", transcript: null },
    });
  });
  await page.goto("/");

  await row(page, alpha?.title ?? "").hover();
  await page.getByRole("checkbox", { name: `Select ${alpha?.title}` }).click();
  await page
    .getByRole("checkbox", { name: `Select ${charlie?.title}` })
    .click({ modifiers: ["Shift"] });
  const bar = page.getByRole("group", { name: "Selected recordings" });
  await expect(bar.getByRole("status")).toHaveText("3 selected");
  await expect(page.getByRole("group", { name: "Type" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: `Select ${bravo?.title}` })).toBeChecked();

  await bar.getByRole("button", { name: "Transcribe 2" }).click();
  await expect
    .poll(() => started.toSorted())
    .toEqual([`${alpha?.id}:start`, `${bravo?.id}:retry`].toSorted());
  await expect(bar.getByRole("status")).toHaveText("1 selected");
  await expect(page.getByRole("checkbox", { name: `Select ${charlie?.title}` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Select ${alpha?.title}` })).not.toBeChecked();

  await bar.getByRole("checkbox", { name: "Select all recordings" }).click();
  await expect(bar.getByRole("status")).toHaveText("4 selected");
  await bar.getByRole("button", { name: "Delete…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete 4 recordings?");
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    `Deleted 3 of 4. “${delta?.title}” was not deleted: Cancel the transcription before deleting this recording.`,
  );
  await expect(dialog).toContainText("Delete 1 recording?");
  expect(library.items.map((item) => item.title)).toEqual([delta?.title]);
  await dialog.getByRole("button", { name: "Keep recording" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bar.getByRole("status")).toHaveText("1 selected");
  await expect(bar.getByRole("button", { name: "Delete…" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Type" })).toBeVisible();

  await row(page, delta?.title ?? "").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select" }).click();
  await expect(bar.getByRole("status")).toHaveText("1 selected");
  await expect(page.getByRole("checkbox", { name: `Select ${delta?.title}` })).toBeChecked();
});
