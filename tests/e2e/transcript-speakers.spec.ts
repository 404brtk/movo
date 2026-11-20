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
const openExportMenu = (page: Page) =>
  transcription(page).getByRole("button", { name: "Export transcript", exact: true }).click();
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

test("remembers which details to include when copying and exporting the transcript", async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
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
  const included =
    "[00:00:00] Good morning everyone.\n[00:00:01] Thanks for having me.\n[00:00:02] Let us begin.";
  const exportMenu = transcription(page).getByRole("button", {
    name: "Export transcript",
    exact: true,
  });
  const speakerNames = page.getByRole("group", { name: "Speaker names" });
  const placement = (name: string) => speakerNames.getByRole("menuitemradio", { name });
  const timestamps = page.getByRole("menuitemcheckbox", { name: "Timestamps in TXT" });

  await exportMenu.click();
  await expect(page.getByRole("menuitemradio")).toHaveText([
    "At each turn",
    "On every line",
    "Off",
  ]);
  await expect(placement("At each turn")).toHaveAttribute("aria-checked", "true");
  await expect(timestamps).toHaveAttribute("aria-checked", "false");
  await placement("Off").click();
  await timestamps.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(placement("At each turn")).toHaveAttribute("aria-checked", "false");
  await expect(placement("Off")).toHaveAttribute("aria-checked", "true");
  await expect(timestamps).toHaveAttribute("aria-checked", "true");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^Download TXT/u }).click();
  const path = testInfo.outputPath("included.txt");
  await (await downloadPromise).saveAs(path);
  expect(readFileSync(path, "utf8")).toBe(included);

  await transcription(page).getByRole("button", { name: "Copy transcript", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(included);

  await page.reload();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export transcript", exact: true }).click();
  await expect(placement("Off")).toHaveAttribute("aria-checked", "true");
  await expect(timestamps).toHaveAttribute("aria-checked", "true");
  await placement("On every line").click();
  await expect(placement("On every line")).toHaveAttribute("aria-checked", "true");
  const subtitles = await page
    .getByRole("menuitem", { name: /^Download SRT/u })
    .evaluate((link: HTMLAnchorElement) => link.href);
  expect(new URL(subtitles).search).toBe("?speakers=line&timestamps=true");
});

test("keeps export choices from other open tabs when changing one in this tab", async ({
  page,
  context,
  recording,
}) => {
  const otherTab = await context.newPage();
  await otherTab.goto(recording.url);

  await openExportMenu(otherTab);
  await otherTab.getByRole("menuitemradio", { name: "On every line" }).click();
  await otherTab.keyboard.press("Escape");

  await openExportMenu(page);
  await expect(page.getByRole("menuitemradio", { name: "On every line" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemcheckbox", { name: "Timestamps in TXT" }).click();
  const subtitles = await page
    .getByRole("menuitem", { name: /^Download SRT/u })
    .evaluate((link: HTMLAnchorElement) => link.href);
  expect(new URL(subtitles).search).toBe("?speakers=line&timestamps=true");
});

test("starts from the default export choices when the remembered ones are unreadable", async ({
  page,
}) => {
  for (const stored of ["{", JSON.stringify({ speakers: true, timestamps: true })]) {
    await page.evaluate(
      (value) => localStorage.setItem("movo.transcript.exportOptions", value),
      stored,
    );
    await page.reload();
    await openExportMenu(page);
    await expect(page.getByRole("menuitemradio", { name: "At each turn" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("menuitemcheckbox", { name: "Timestamps in TXT" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await page.keyboard.press("Escape");
  }
});

test("moves passages between speakers, merges them, names the remaining speaker and undoes the merge from history", async ({
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
  await expect(speakerHeadings(page)).toHaveText(["Speaker 2"]);
  await expect(passages(page)).toHaveCount(3);

  await speakerHeadings(page).first().click();
  await expect(page.getByRole("menuitem", { name: "Merge into" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Name speaker…" }).click();
  await page.getByRole("dialog", { name: "Name Speaker 2" }).getByRole("textbox").fill("Ann");
  await page.keyboard.press("Enter");
  await expect(speakerHeadings(page)).toHaveText(["Ann"]);

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
  await expect(speakerHeadings(page)).toHaveText(["Speaker 3", "Ann"]);
});
