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

const test = base.extend<{ recording: { origin: string; title: string; url: string } }>({
  recording: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-editing-"));
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
              const title = `Editing ${randomUUID()}`;
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

const transcription = (page: Page) =>
  page.getByRole("region", { name: "Transcription", exact: true });
const passages = (page: Page) =>
  transcription(page).getByRole("list", { name: "Timestamped passages" }).getByRole("listitem");

test.beforeEach(async ({ page, recording }) => {
  await page.goto(recording.url);
});

test("edits a passage with the keyboard, keeps it after reload and finds the new text", async ({
  page,
  recording,
}) => {
  const edit = transcription(page).getByRole("button", { name: "Edit passage at 0:00" });
  await edit.click();
  const text = page.getByRole("textbox", { name: "Passage text" });
  await expect(text).toBeFocused();
  await expect(text).toHaveValue("We deploy kubernetis daily.");
  await text.fill("Ignored change.");
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await expect(passages(page).first()).toContainText("We deploy kubernetis daily.");

  await edit.click();
  await text.fill("We deploy Kubernetes clusters daily.");
  await page.keyboard.press("Control+Enter");
  await expect(passages(page).first()).toContainText("We deploy Kubernetes clusters daily.");
  await expect(edit).toBeFocused();
  await expect(transcription(page)).toContainText("processed on this computer · edited.");

  await page.reload();
  await expect(passages(page).first()).toContainText("We deploy Kubernetes clusters daily.");
  await page.goto(`${recording.origin}/?q=clusters`);
  await expect(page.getByRole("link", { name: recording.title })).toBeVisible();
});

test("previews and applies find and replace, then undoes and restores versions", async ({
  page,
}) => {
  const panel = transcription(page);
  await panel.getByRole("button", { name: "Find and replace" }).click();
  const form = panel.getByRole("form", { name: "Find and replace" });
  await expect(form.getByLabel("Find", { exact: true })).toBeFocused();
  await form.getByLabel("Find", { exact: true }).fill("KUBERNETIS");
  await form.getByLabel("Replace with").fill("Kubernetes");
  await expect(form.getByRole("status")).toHaveText("2 matches to replace.");
  await expect(form.getByRole("list", { name: "Changes to make" })).toContainText(
    "kubernetis → Kubernetes",
  );
  await form.getByRole("button", { name: "Replace all" }).click();
  await expect(form.getByRole("status")).toHaveText("Replaced 2 matches.");
  await expect(passages(page)).toHaveText([
    /We deploy Kubernetes daily\./u,
    /Kubernetes keeps running\./u,
  ]);
  await expect(form.getByRole("button", { name: "Replace all" })).toBeDisabled();

  await panel.getByRole("button", { name: "Edit passage at 0:01" }).click();
  await page.getByRole("textbox", { name: "Passage text" }).fill("Kubernetes keeps working.");
  await page.getByRole("button", { name: "Save passage" }).click();

  await panel.getByRole("button", { name: "History" }).click();
  const versions = panel.getByRole("list", { name: "Transcript versions" }).getByRole("listitem");
  await expect(versions).toHaveText([
    /“running\.” → “working\.”Version 2.*Current/u,
    /“kubernetis” → “Kubernetes” in 2 placesVersion 1.*/u,
    /Transcription resultVersion 0/u,
  ]);
  await panel.getByRole("button", { name: "Undo last change" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Restored" })).toHaveText(
    "Restored version 1.",
  );
  await expect(passages(page).last()).toContainText("Kubernetes keeps running.");
  await panel.getByRole("button", { name: "Restore version 0" }).click();
  await expect(passages(page)).toHaveText([
    /We deploy kubernetis daily\./u,
    /Kubernetis keeps running\./u,
  ]);
  await expect(versions.first()).toHaveText(/Restored the transcription resultVersion 4.*Current/u);
});

test("asks before transcribing again replaces edits and then starts a new history", async ({
  page,
}) => {
  const panel = transcription(page);
  await panel.getByRole("button", { name: "Edit passage at 0:00" }).click();
  await page.getByRole("textbox", { name: "Passage text" }).fill("Edited first passage.");
  await page.keyboard.press("Control+Enter");
  await expect(passages(page).first()).toContainText("Edited first passage.");

  await panel.getByRole("button", { name: "Transcribe again" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace your edits?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep edits" }).click();
  await expect(dialog).toBeHidden();
  await expect(passages(page).first()).toContainText("Edited first passage.");

  await panel.getByRole("button", { name: "Transcribe again" }).click();
  await dialog.getByRole("button", { name: "Transcribe again" }).click();
  await expect(passages(page).first()).toContainText("We deploy kubernetis daily.");
  await expect(panel).not.toContainText("· edited");
  await panel.getByRole("button", { name: "History" }).click();
  await expect(
    panel.getByRole("list", { name: "Transcript versions" }).getByRole("listitem"),
  ).toHaveText([/Transcription resultVersion 0Current/u]);
});
