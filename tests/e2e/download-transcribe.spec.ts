import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Deferred, Effect } from "effect";
import { expect, test as base } from "@playwright/test";
import { openDatabase } from "../../src/server/db/database.ts";
import { createDownloads } from "../../src/server/downloads/jobs.ts";
import { createApp } from "../../src/server/http/app.ts";
import { MediaError } from "../../src/server/media/error.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { createYtdlp } from "../../src/server/media-tools/ytdlp.ts";
import { createModels } from "../../src/server/models/models.ts";
import { createTranscriptions } from "../../src/server/transcriptions/jobs.ts";
import { serveBrowserApp } from "../helpers/browser-server.ts";
import { timedWords } from "../helpers/timed-words.ts";

const sourceUrl = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const title = "Download and transcribe example";
const passage = "Automatically transcribed recording.";
const test = base.extend<{
  workflow: { origin: string; enableModel: () => void; finishTranscription: () => Promise<void> };
}>({
  workflow: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-download-transcribe-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const tools = yield* Effect.acquireRelease(
              Effect.sync(() => createMediaTools(config)),
              (manager) => manager.close(),
            );
            const models = yield* Effect.acquireRelease(
              Effect.sync(() => createModels({ cacheDirectory: join(directory, "hf-cache") })),
              (manager) => manager.close(),
            );
            const finish = yield* Deferred.make<void>();
            let ready = false;
            const transcriptions = createTranscriptions(database, config, tools, {
              check: () =>
                ready
                  ? Effect.void
                  : Effect.fail(
                      new MediaError("unavailable", "Install Parakeet Ultra before transcribing."),
                    ),
              transcribe: (_path, _staging, update) =>
                Effect.gen(function* () {
                  update("transcribing");
                  yield* Deferred.await(finish);
                  return {
                    language: "en",
                    words: [...timedWords(100, 900, passage)],
                  };
                }),
            });
            const downloads = createDownloads(database, config, tools, {
              preview: () => Effect.succeed({ url: sourceUrl, title, durationSeconds: 2 }),
              download: (_url, staging) =>
                Effect.gen(function* () {
                  const path = join(staging, "media.wav");
                  yield* Effect.promise(() =>
                    copyFile(new URL("../fixtures/tone.wav", import.meta.url), path),
                  );
                  return { path, preview: { url: sourceUrl, title, durationSeconds: 2 } };
                }),
            });
            yield* downloads.start();
            yield* transcriptions.start();
            const ytdlp = yield* Effect.acquireRelease(
              Effect.sync(() =>
                createYtdlp(
                  { ...config, ytdlpPath: process.execPath },
                  { run: async () => "2026.10.26\n" },
                ),
              ),
              (manager) => manager.close(),
            );
            const app = createApp(database, config, resolve("dist/web"), {
              tools,
              ytdlp,
              models,
              downloads,
              transcriptions,
            });
            const origin = yield* serveBrowserApp(app);
            yield* Effect.promise(async () => {
              expect((await request.get(`${origin}/api/media`)).status()).toBe(200);
              await use({
                origin,
                enableModel: () => {
                  ready = true;
                },
                finishTranscription: () =>
                  Effect.runPromise(Deferred.succeed(finish, undefined)).then(() => undefined),
              });
            });
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
});

test("downloads and transcribes once, reports missing prerequisites and shows the finished transcript in a filtered library", async ({
  page,
  workflow,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(workflow.origin);
  await page.getByRole("textbox", { name: "Video link" }).fill(sourceUrl);
  await page.getByRole("button", { name: "Check link", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "Transcribe after download" });
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.getByLabel("Save as", { exact: true }).selectOption("audio");
  await page.getByRole("button", { name: "Download and transcribe", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Install Parakeet Ultra before transcribing.");
  workflow.enableModel();
  await page.getByRole("button", { name: "Download and transcribe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  await expect(page.getByText("Saved to library", { exact: false })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Transcription requested. Open media to view its progress.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open media", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel transcription", exact: true }),
  ).toBeVisible();
  await page.goto(`${workflow.origin}/?transcript=available`);
  await expect(page.getByRole("heading", { name: "No recordings match" })).toBeVisible();
  await workflow.finishTranscription();
  await page.getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expect(page.getByText(passage, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(passage, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy text", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
