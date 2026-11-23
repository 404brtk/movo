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
  recording: { origin: string; mediaId: string; title: string; url: string };
}>({
  recording: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-editing-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const tools = createMediaTools(config);
            const models = createModels({ database, cacheDirectory: join(directory, "hf-cache") });
            yield* Effect.addFinalizer(() => models.close());
            const transcriptions = createTranscriptions(database, config, tools, {
              check: () => Effect.void,
              transcribe: (_request, report) =>
                Effect.sync(() => {
                  report.device({ backend: "cpu", name: "Test CPU" });
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
              await use({ origin, mediaId: media.id, title, url: `${origin}/media/${media.id}` });
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
  await expect(page.getByRole("main")).toContainText("Parakeet Ultra · edited");

  await page.reload();
  await expect(passages(page).first()).toContainText("We deploy Kubernetes clusters daily.");
  await page.goto(`${recording.origin}/?q=clusters`);
  await expect(page.getByRole("link", { name: recording.title })).toBeVisible();
});

test("previews and applies find and replace, then undoes and restores versions", async ({
  page,
}) => {
  const panel = transcription(page);
  await panel.getByRole("button", { name: "Replace", exact: true }).click();
  const form = panel.getByRole("form", { name: "Find and replace" });
  await expect(form.getByLabel("Find", { exact: true })).toBeFocused();
  await form.getByLabel("Find", { exact: true }).fill("KUBERNETIS");
  await form.getByLabel("Replace with").fill("Kubernetes");
  await expect(form.getByText("1 of 2", { exact: true })).toBeVisible();
  await expect(panel.locator("mark")).toHaveText(["kubernetis", "Kubernetis"]);
  await form.getByLabel("Find", { exact: true }).press("Enter");
  await expect(form.getByText("2 of 2", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Replace all" }).click();
  await expect(page.getByText("Replaced 2 matches", { exact: true })).toBeVisible();
  await expect(passages(page)).toHaveText([
    /We deploy Kubernetes daily\./u,
    /Kubernetes keeps running\./u,
  ]);
  await expect(form.getByRole("button", { name: "Replace all" })).toBeDisabled();

  await panel.getByRole("button", { name: "Edit passage at 0:01" }).click();
  await page.getByRole("textbox", { name: "Passage text" }).fill("Kubernetes keeps working.");
  await page.getByRole("button", { name: "Save passage" }).click();
  await form.getByRole("button", { name: "Close", exact: true }).click();

  const history = panel.getByRole("button", { name: "History" });
  await history.click();
  const versions = page.getByRole("list", { name: "Transcript versions" }).getByRole("listitem");
  await expect(versions).toHaveText([
    /^Edited passage at 0:01.*Current$/u,
    /^Replaced “kubernetis” with “Kubernetes”2 replacements · /u,
    /^Transcription result/u,
  ]);
  await page.getByRole("button", { name: /^Restore: Replaced “kubernetis”/u }).click();
  await expect(page.getByRole("status").filter({ hasText: "Restored" })).toHaveText(
    "Restored an earlier version.",
  );
  await expect(versions.first()).toHaveText(
    /^Restored an earlier versionBack to: Replaced “kubernetis” with “Kubernetes” · .*Current$/u,
  );
  await page.keyboard.press("Escape");
  await expect(history).toBeFocused();
  await expect(passages(page).last()).toContainText("Kubernetes keeps running.");
  await history.click();
  await page.getByRole("button", { name: /^Restore: Transcription result/u }).click();
  await expect(versions).toHaveText([
    /^Restored the transcription result.*Current$/u,
    /^Edited passage at 0:01/u,
    /^Replaced “kubernetis” with “Kubernetes”/u,
    /^Transcription result/u,
  ]);
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(passages(page)).toHaveText([
    /We deploy kubernetis daily\./u,
    /Kubernetis keeps running\./u,
  ]);

  await history.click();
  let openHistory: (() => void) | undefined;
  const historyGate = new Promise<void>((open) => {
    openHistory = open;
  });
  await page.route("**/transcription/changes?*", async (route) => {
    await historyGate;
    await route.fallback();
  });
  await page.getByRole("button", { name: /^Restore: Edited passage at 0:01/u }).click();
  await expect(page.getByRole("list", { name: "Transcript versions" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(versions.getByText("Current", { exact: true })).toHaveCount(0);
  for (const restoreButton of await versions.getByRole("button").all())
    await expect(restoreButton).toBeDisabled();
  openHistory?.();
  await page.unroute("**/transcription/changes?*");
  await expect(versions).toHaveText([
    /^Edited passage at 0:01.*Current$/u,
    /^Replaced “kubernetis” with “Kubernetes”/u,
    /^Transcription result/u,
  ]);
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(passages(page).last()).toContainText("Kubernetes keeps working.");
});

test("undoes a replacement after the bar closed mid-save and after switching versions", async ({
  page,
  recording,
}) => {
  const statusUrl = `${recording.origin}/api/media/${recording.mediaId}/transcription`;
  const change = async (action: string, body: object) =>
    expect((await page.request.post(`${statusUrl}/${action}`, { data: body })).status()).toBe(200);
  await change("replace", { revision: 1, find: "kubernetis", replacement: "Kubernetes" });
  await change("restore", { revision: 2, target: 1 });
  await change("restore", { revision: 3, target: 2 });
  await page.reload();
  await expect(passages(page)).toHaveText([
    /We deploy Kubernetes daily\./u,
    /Kubernetes keeps running\./u,
  ]);

  const panel = transcription(page);
  await panel.getByRole("button", { name: "Replace", exact: true }).click();
  const form = panel.getByRole("form", { name: "Find and replace" });
  await form.getByLabel("Find", { exact: true }).fill("Kubernetes");
  await form.getByLabel("Replace with").fill("K8s");
  await expect(form.getByText("1 of 2", { exact: true })).toBeVisible();
  let saveReplacement: (() => void) | undefined;
  const replacementGate = new Promise<void>((open) => {
    saveReplacement = open;
  });
  await page.route("**/transcription/replace", async (route) => {
    await replacementGate;
    await route.fallback();
  });
  await form.getByRole("button", { name: "Replace all" }).click();
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await expect(form).toBeHidden();
  saveReplacement?.();
  await page.unroute("**/transcription/replace");
  await expect(passages(page)).toHaveText([/We deploy K8s daily\./u, /K8s keeps running\./u]);
  await expect(page.getByText("Replaced 2 matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(passages(page)).toHaveText([
    /We deploy Kubernetes daily\./u,
    /Kubernetes keeps running\./u,
  ]);
  await expect(page.getByText("Could not undo the replacement")).toHaveCount(0);
});

test("offers Undo and reports its failure after leaving the recording", async ({
  page,
  recording,
}) => {
  const statusUrl = `${recording.origin}/api/media/${recording.mediaId}/transcription`;
  const exported = async () => (await page.request.get(`${statusUrl}/export/txt`)).text();
  const panel = transcription(page);
  const replaceAll = async (find: string, replacement: string) => {
    await panel.getByRole("button", { name: "Replace", exact: true }).click();
    const form = panel.getByRole("form", { name: "Find and replace" });
    await form.getByLabel("Find", { exact: true }).fill(find);
    await form.getByLabel("Replace with").fill(replacement);
    await expect(form.getByText("1 of 2", { exact: true })).toBeVisible();
    await form.getByRole("button", { name: "Replace all" }).click();
  };
  const leave = async () => {
    await page.getByRole("link", { name: "Back to library" }).click();
    await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  };

  let saveReplacement: (() => void) | undefined;
  const replacementGate = new Promise<void>((open) => {
    saveReplacement = open;
  });
  await page.route("**/transcription/replace", async (route) => {
    await replacementGate;
    await route.fallback();
  });
  await replaceAll("kubernetis", "Kubernetes");
  await leave();
  saveReplacement?.();
  await page.unroute("**/transcription/replace");
  await expect(page.getByText("Replaced 2 matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(exported).toBe("We deploy kubernetis daily.\nKubernetis keeps running.");

  await page.goto(recording.url);
  await replaceAll("kubernetis", "Kubernetes");
  await expect(page.getByText("Replaced 2 matches", { exact: true })).toBeVisible();
  await leave();
  const job: TranscriptionJob = await (await page.request.get(statusUrl)).json();
  const edited = await page.request.post(`${statusUrl}/replace`, {
    data: { revision: job.revision, find: "running", replacement: "working" },
  });
  expect(edited.status()).toBe(200);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByText("Could not undo the replacement"),
  ).toBeVisible();
  await expect.poll(exported).toBe("We deploy Kubernetes daily.\nKubernetes keeps working.");
});

test("asks before transcribing again replaces edits and then starts a new history", async ({
  page,
}) => {
  const panel = transcription(page);
  await panel.getByRole("button", { name: "Edit passage at 0:00" }).click();
  await page.getByRole("textbox", { name: "Passage text" }).fill("Edited first passage.");
  await page.keyboard.press("Control+Enter");
  await expect(passages(page).first()).toContainText("Edited first passage.");

  const more = page.getByRole("button", { name: "More actions", exact: true });
  await more.click();
  await page.getByRole("menuitem", { name: "Transcribe again", exact: true }).click();
  await page.getByRole("menuitem", { name: "No speaker labels…", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace your edits?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep edits" }).click();
  await expect(dialog).toBeHidden();
  await expect(passages(page).first()).toContainText("Edited first passage.");

  await more.click();
  await page.getByRole("menuitem", { name: "Transcribe again", exact: true }).click();
  await page.getByRole("menuitem", { name: "No speaker labels…", exact: true }).click();
  await dialog.getByRole("button", { name: "Transcribe again" }).click();
  await expect(passages(page).first()).toContainText("We deploy kubernetis daily.");
  await expect(page.getByRole("main")).not.toContainText("· edited");
  await panel.getByRole("button", { name: "History" }).click();
  await expect(
    page.getByRole("list", { name: "Transcript versions" }).getByRole("listitem"),
  ).toHaveText([/^Transcription result.*Current$/u]);
});

test("keeps a passage draft when another client changes the transcript first", async ({
  page,
  recording,
}) => {
  const panel = transcription(page);
  await panel.getByRole("button", { name: "Edit passage at 0:00" }).click();
  const text = page.getByRole("textbox", { name: "Passage text" });
  await text.fill("We ship Kubernetes daily.");
  const statusUrl = `${recording.origin}/api/media/${recording.mediaId}/transcription`;
  const job: TranscriptionJob = await (await page.request.get(statusUrl)).json();
  const replaced = await page.request.post(`${statusUrl}/replace`, {
    data: { revision: job.revision, find: "running", replacement: "working" },
  });
  expect(replaced.status()).toBe(200);

  await page.getByRole("button", { name: "Save passage" }).click();
  const notice = panel.getByRole("alert").filter({ hasText: "changed while you were editing" });
  await expect(notice).toContainText("This passage now reads “We deploy kubernetis daily.”.");
  await expect(page.getByRole("button", { name: "Save passage" })).toBeDisabled();
  await expect(text).toHaveValue("We ship Kubernetes daily.");
  await notice.getByRole("button", { name: "Use my text for the current passage" }).click();
  await page.getByRole("button", { name: "Save passage" }).click();
  await expect(passages(page)).toHaveText([
    /We ship Kubernetes daily\./u,
    /Kubernetis keeps working\./u,
  ]);
});
