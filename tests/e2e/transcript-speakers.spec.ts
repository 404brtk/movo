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

const spoken = (speaker: number, startMs: number, endMs: number, text: string) =>
  timedWords(startMs, endMs, text).map((word) => ({ ...word, speaker }));

const test = base.extend<{ recording: { origin: string; mediaId: string; url: string } }>({
  recording: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-speakers-"));
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
                      ...spoken(1, 0, 900, "Good morning everyone."),
                      ...spoken(2, 1000, 1900, "Thanks for having me."),
                      ...spoken(1, 2000, 2900, "Let us begin."),
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
              const uploaded = await request.post(`${origin}/api/media`, {
                data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
                headers: { "x-file-name": encodeURIComponent(`Speakers ${randomUUID()}.wav`) },
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
              await use({ origin, mediaId: media.id, url: `${origin}/media/${media.id}` });
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
const speakerHeadings = (page: Page) =>
  transcription(page).getByRole("button", { name: /, speaker options$/u });

test.beforeEach(async ({ page, recording }) => {
  await page.goto(recording.url);
});

test("names a speaker everywhere in the transcript and keeps the name after reload", async ({
  page,
  request,
  recording,
}) => {
  await expect(speakerHeadings(page)).toHaveText(["Speaker 1", "Speaker 2", "Speaker 1"]);
  await expect(passages(page).nth(1)).toContainText("Thanks for having me.");

  await speakerHeadings(page).nth(1).click();
  await page.getByRole("menuitem", { name: "Name speaker…" }).click();
  const dialog = page.getByRole("dialog", { name: "Name Speaker 2" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  await name.fill("  Ann  ");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog).toBeHidden();
  await expect(speakerHeadings(page)).toHaveText(["Speaker 1", "Ann", "Speaker 1"]);

  await page.reload();
  await expect(speakerHeadings(page)).toHaveText(["Speaker 1", "Ann", "Speaker 1"]);
  const exported = await request.get(
    `${recording.origin}/api/media/${recording.mediaId}/transcription/export/txt`,
  );
  expect(await exported.text()).toBe(
    "Speaker 1: Good morning everyone.\n\nAnn: Thanks for having me.\n\nSpeaker 1: Let us begin.",
  );

  await speakerHeadings(page).nth(1).click();
  await page.getByRole("menuitem", { name: "Rename speaker…" }).click();
  const renaming = page.getByRole("dialog", { name: "Name Ann" }).getByRole("textbox");
  await expect(renaming).toHaveValue("Ann");
  await renaming.fill("");
  await renaming.press("Enter");
  await expect(speakerHeadings(page)).toHaveText(["Speaker 1", "Speaker 2", "Speaker 1"]);
});

test("moves passages between speakers, merges them and undoes the merge from history", async ({
  page,
}) => {
  const panel = transcription(page);
  await panel.getByRole("button", { name: "Change speaker of passage at 0:02" }).click();
  await page.getByRole("menuitemradio", { name: "Speaker 2" }).click();
  await expect(speakerHeadings(page)).toHaveText(["Speaker 1", "Speaker 2"]);

  await panel.getByRole("button", { name: "Change speaker of passage at 0:00" }).click();
  await page.getByRole("menuitem", { name: "New speaker" }).click();
  await expect(speakerHeadings(page)).toHaveText(["Speaker 3", "Speaker 2"]);

  await speakerHeadings(page).first().click();
  await page.getByRole("menuitem", { name: "Merge into" }).click();
  await page.getByRole("menuitem", { name: "Speaker 2" }).click();
  await expect(speakerHeadings(page)).toHaveCount(0);
  await expect(passages(page)).toHaveCount(3);

  await panel.getByRole("button", { name: "History" }).click();
  const versions = page.getByRole("list", { name: "Transcript versions" }).getByRole("listitem");
  await expect(versions).toHaveText([
    /^Changed the speaker at 0:00.*Current$/u,
    /^Changed the speaker at 0:00/u,
    /^Changed the speaker at 0:02/u,
    /^Transcription result/u,
  ]);
  await page
    .getByRole("button", { name: /^Restore: Changed the speaker at 0:00/u })
    .first()
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Restored" })).toHaveText(
    "Restored an earlier version.",
  );
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(speakerHeadings(page)).toHaveText(["Speaker 3", "Speaker 2"]);
});
