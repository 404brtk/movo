import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { expect, test as base, type Page } from "@playwright/test";
import { openDatabase } from "../../src/server/db/database.ts";
import { createApp } from "../../src/server/http/app.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { createModels } from "../../src/server/models/models.ts";
import { createTranscriptions } from "../../src/server/transcriptions/jobs.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { serveBrowserApp } from "../helpers/browser-server.ts";
import { timedWords } from "../helpers/timed-words.ts";

const test = base.extend<{
  recording: { origin: string; title: string; url: string };
}>({
  recording: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-dictionary-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const tools = createMediaTools(config);
            const models = createModels({ cacheDirectory: join(directory, "hf-cache") });
            yield* Effect.addFinalizer(() => models.close());
            const transcriptions = createTranscriptions(database, config, tools, {
              check: () => Effect.void,
              transcribe: (_path, _staging, _update, reportDevice) =>
                Effect.sync(() => {
                  reportDevice({ backend: "cpu", name: "Test CPU" });
                  return {
                    language: "en",
                    words: [
                      ...timedWords(0, 900, "We deploy kubernetis daily."),
                      ...timedWords(1000, 1900, "Kubernetis keeps running."),
                    ],
                  };
                }),
            });
            yield* transcriptions.start();
            const app = createApp(database, config, resolve("dist/web"), {
              tools,
              models,
              transcriptions,
            });
            const origin = yield* serveBrowserApp(app);
            yield* Effect.promise(async () => {
              const title = `Dictionary ${randomUUID()}`;
              const uploaded = await request.post(`${origin}/api/media`, {
                data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
                headers: { "x-file-name": encodeURIComponent(`${title}.wav`) },
              });
              expect(uploaded.status()).toBe(201);
              const media: { id: string } = await uploaded.json();
              const statusUrl = `${origin}/api/media/${media.id}/transcription`;
              expect((await request.post(statusUrl)).status()).toBe(202);
              await expect
                .poll(async () => {
                  const job: TranscriptionJob = await (await request.get(statusUrl)).json();
                  return job.status;
                })
                .toBe("completed");
              await use({ origin, title, url: `${origin}/media/${media.id}` });
            });
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
});

const dialog = (page: Page) => page.locator("[data-slot=dialog-content]");
const row = (page: Page) => page.getByRole("listitem", { name: "Dictionary", exact: true });

test("adds an entry, fixes only the ticked matches and records them in History", async ({
  page,
  recording,
}) => {
  await page.goto(`${recording.origin}/settings`);
  await expect(row(page)).toContainText("Names and words Movo spells your way in new transcripts.");
  await row(page).getByRole("button", { name: "Manage" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Dictionary" })).toBeVisible();
  const search = dialog(page).getByRole("searchbox", { name: "Find or add a name or word" });
  await expect(search).toBeFocused();
  await expect(dialog(page)).toContainText("No words yet.");

  await search.fill("Kubernetes");
  await expect(dialog(page).getByRole("button", { name: /Add “Kubernetes”/u })).toBeVisible();
  await search.press("Enter");
  await expect(dialog(page).getByRole("heading", { name: "New entry" })).toBeVisible();
  await expect(dialog(page).getByLabel("Spelled")).toHaveValue("Kubernetes");
  const similar = dialog(page).getByRole("switch", { name: "Similar spellings" });
  await expect(similar).not.toBeChecked();
  await expect(dialog(page)).toContainText("Nothing to fix yet. New transcripts will use it.");
  await similar.click();
  const matches = dialog(page).getByRole("list", { name: "Matches in your library" });
  await expect(matches.getByRole("listitem")).toHaveCount(2);
  await expect(dialog(page)).toContainText("Already in your library2 in 1 recording");
  await expect(dialog(page)).toContainText("Also fixes “kubernetis” and “Kubernetis”");
  await matches.getByRole("checkbox").nth(1).uncheck();
  await expect(dialog(page)).toContainText("2 in 1 recording · 1 left as heard");
  let release: (() => void) | undefined;
  const held = new Promise<void>((open) => {
    release = open;
  });
  await page.route(
    "**/api/dictionary",
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  await dialog(page).getByRole("button", { name: "Add and fix 1 recording" }).click();
  await expect(dialog(page).getByRole("button", { name: "Fixing…" })).toBeVisible();
  await expect(dialog(page).getByRole("textbox", { name: "Add to Also replace" })).toBeDisabled();
  await expect(dialog(page).getByRole("textbox", { name: "Add to Never change" })).toBeDisabled();
  release?.();

  await expect(page.getByText("Fixed 1 word in 1 recording")).toBeVisible();
  await expect(dialog(page).getByRole("heading", { name: "Dictionary" })).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: /^Kubernetes Similar spellings 1 fix$/u }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText("1 entry · 1 fix so far");
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(row(page)).toContainText("1 name or word Movo spells your way · Kubernetes");
  await expect(row(page).getByRole("button", { name: "Manage" })).toBeFocused();

  await page.goto(recording.url);
  const transcription = page.getByRole("region", { name: "Transcription", exact: true });
  await expect(transcription).toContainText("We deploy Kubernetes daily.");
  await expect(transcription).toContainText("Kubernetis keeps running.");
  await transcription.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("Dictionary fixed “Kubernetes”")).toBeVisible();
});

test("asks before discarding changes, links clashes to their entry and removes an entry", async ({
  page,
  recording,
}) => {
  await page.goto(`${recording.origin}/settings`);
  await row(page).getByRole("button", { name: "Manage" }).click();
  const search = dialog(page).getByRole("searchbox", { name: "Find or add a name or word" });
  await search.fill("Movo");
  await search.press("Enter");
  await expect(dialog(page).getByRole("switch", { name: "Similar spellings" })).toBeDisabled();
  await expect(dialog(page)).toContainText("Off for words of 4 letters or fewer");
  await expect(dialog(page)).toContainText("Nothing to fix yet. New transcripts will use it.");
  await dialog(page).getByRole("textbox", { name: "Add to Also replace" }).fill("mo vo");
  await dialog(page).getByRole("textbox", { name: "Add to Also replace" }).press("Enter");
  await dialog(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: /^Movo Exact spelling/u })).toBeVisible();

  await search.fill("Codex");
  await search.press("Enter");
  const alsoReplace = dialog(page).getByRole("textbox", { name: "Add to Also replace" });
  await alsoReplace.fill("kodex");
  await alsoReplace.press("Enter");
  await dialog(page).getByLabel("Spelled").fill("Kodex");
  await expect(dialog(page).getByRole("alert")).toHaveText(
    "“kodex” is the spelling itself. Remove it from Also replace.",
  );
  await expect(dialog(page).getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await dialog(page).getByRole("button", { name: "Remove “kodex”" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await dialog(page).getByLabel("Spelled").fill("Codex");
  await alsoReplace.fill("MO VO");
  await alsoReplace.press("Enter");
  await expect(dialog(page).getByRole("alert")).toHaveText(
    "“MO VO” already becomes Movo. Open Movo",
  );
  await dialog(page).getByLabel("Spelled").fill("movo");
  await expect(dialog(page).getByRole("alert").first()).toHaveText(
    "“Movo” is already in the dictionary. Open Movo",
  );
  await expect(dialog(page).getByRole("button", { name: "Add", exact: true })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toContainText("Discard your changes?");
  await dialog(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog(page).getByLabel("Spelled")).toHaveValue("movo");
  await dialog(page).getByRole("button", { name: "Open Movo" }).first().click();
  await dialog(page).getByRole("button", { name: "Discard" }).click();
  await expect(dialog(page).getByLabel("Spelled")).toHaveValue("Movo");
  await expect(dialog(page).getByLabel("Spelled")).toBeFocused();
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Back to Dictionary" }).click();
  await expect(search).toBeFocused();

  await dialog(page)
    .getByRole("button", { name: /^Movo Exact spelling/u })
    .click();
  const neverChange = dialog(page).getByRole("textbox", { name: "Add to Never change" });
  await neverChange.fill("movo bird");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toContainText("Discard your changes?");
  await dialog(page).getByRole("button", { name: "Keep editing" }).click();
  await dialog(page).getByRole("button", { name: "Remove “movo bird”" }).click();
  await dialog(page).getByRole("button", { name: "Movo actions" }).click();
  await page.getByRole("menuitem", { name: "Remove from dictionary…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Remove Movo from the dictionary?");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(dialog(page)).toContainText("No words yet.");
});
