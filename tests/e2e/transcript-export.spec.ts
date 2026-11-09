import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { expect, test as base } from "@playwright/test";
import { openDatabase } from "../../src/server/db/database.ts";
import { createApp } from "../../src/server/http/app.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { createModels } from "../../src/server/models/models.ts";
import { createTranscriptions } from "../../src/server/transcriptions/jobs.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { serveBrowserApp } from "../helpers/browser-server.ts";
import { timedWords } from "../helpers/timed-words.ts";

const plainText = "Zażółć gęślą jaźń.\nA & <b>B</b> Second line --> end.";
const exports = [
  { format: "txt", text: plainText },
  {
    format: "srt",
    text: "1\n00:00:00,125 --> 00:00:00,999\nZażółć gęślą jaźń.\n\n2\n00:00:01,000 --> 00:00:01,800\nA &amp; &lt;b&gt;B&lt;/b&gt; Second line --&gt; end.\n\n",
  },
  {
    format: "vtt",
    text: "WEBVTT\n\n1\n00:00:00.125 --> 00:00:00.999\nZażółć gęślą jaźń.\n\n2\n00:00:01.000 --> 00:00:01.800\nA &amp; &lt;b&gt;B&lt;/b&gt; Second line --&gt; end.\n\n",
  },
];

const test = base.extend<{ recording: { title: string; url: string } }>({
  recording: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-export-"));
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
              transcribe: () =>
                Effect.succeed({
                  language: "pl",
                  words: [
                    ...timedWords(125, 999, "Zażółć gęślą jaźń."),
                    ...timedWords(1000, 1800, "A & <b>B</b> Second line --> end."),
                  ],
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
              const title = `Żółć ${randomUUID()}`;
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
              await use({ title, url: `${origin}/media/${media.id}` });
            });
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
});

test.beforeEach(async ({ page, recording }) => {
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
  await page.goto(recording.url);
});

test("copies plain text and downloads UTF-8 transcripts with keyboard-accessible actions", async ({
  page,
  recording,
}, testInfo) => {
  const { title } = recording;
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  const copy = panel.getByRole("button", { name: "Copy transcript", exact: true });
  await expect(copy).toBeVisible();
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status")).toHaveText("Transcript copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(plainText);
  await page.keyboard.press("Tab");
  const exportMenu = panel.getByRole("button", { name: "Export transcript", exact: true });
  await expect(exportMenu).toBeFocused();
  for (const exported of exports) {
    await exportMenu.press("Enter");
    const item = page.getByRole("menuitem", {
      name: new RegExp(`^Download ${exported.format.toUpperCase()}`, "u"),
    });
    await item.focus();
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${title}.${exported.format}`);
    const path = testInfo.outputPath(`transcript.${exported.format}`);
    await download.saveAs(path);
    expect(readFileSync(path, "utf8")).toBe(exported.text);
  }
  const cues = await page.locator("audio").evaluate(
    async (player: HTMLMediaElement, text: string) => {
      const track = document.createElement("track");
      const url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      try {
        track.src = url;
        const loaded = new Promise<void>((resolveLoaded, reject) => {
          track.addEventListener("load", () => resolveLoaded(), { once: true });
          track.addEventListener(
            "error",
            () => reject(new Error("Exported WebVTT could not be loaded.")),
            { once: true },
          );
        });
        player.append(track);
        track.track.mode = "hidden";
        await loaded;
        return Array.from(track.track.cues ?? [], (cue) => {
          if (!(cue instanceof VTTCue)) throw new Error("Expected a WebVTT cue.");
          return { start: cue.startTime, end: cue.endTime, text: cue.getCueAsHTML().textContent };
        });
      } finally {
        track.remove();
        URL.revokeObjectURL(url);
      }
    },
    readFileSync(testInfo.outputPath("transcript.vtt"), "utf8"),
  );
  expect(cues).toEqual([
    { start: 0.125, end: 0.999, text: "Zażółć gęślą jaźń." },
    { start: 1, end: 1.8, text: "A & <b>B</b> Second line --> end." },
  ]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("keeps the recording title when downloading the export URL directly", async ({
  page,
  recording,
}, testInfo) => {
  await page.getByRole("button", { name: "Export transcript", exact: true }).click();
  const url = await page
    .getByRole("menuitem", { name: /^Download VTT/u })
    .evaluate((link: HTMLAnchorElement) => link.href);
  const downloadPromise = page.waitForEvent("download");
  await expect(page.goto(url)).rejects.toThrow(/Download is starting|net::ERR_ABORTED/u);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${recording.title}.vtt`);
  const path = testInfo.outputPath("direct-export.vtt");
  await download.saveAs(path);
  expect(readFileSync(path, "utf8")).toBe(exports[2]?.text);
});

test("reports denied or unavailable clipboard access and allows retrying after reload", async ({
  page,
}) => {
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  const copy = panel.getByRole("button", { name: "Copy transcript", exact: true });
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await copy.click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Could not copy text. Allow clipboard access in your browser, or download TXT.",
  );
  await expect(panel.getByRole("status")).toBeEmpty();
  await expect(copy).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Export transcript", exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await copy.click();
  await expect(panel.getByRole("alert")).toContainText("Could not copy text.");
  await page.reload();
  await copy.click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("status")).toHaveText("Transcript copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(plainText);
});

test("removes the saved copy after confirmation while keeping the transcript readable and exportable", async ({
  page,
  recording,
}, testInfo) => {
  const more = page.getByRole("button", { name: "More actions", exact: true });
  const removeTrigger = page.getByRole("menuitem", { name: "Remove saved copy…", exact: true });
  await more.click();
  await removeTrigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Remove the saved copy of “${recording.title}”?`);
  await dialog.getByRole("button", { name: "Keep saved copy", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("audio")).toHaveCount(1);
  await more.click();
  await removeTrigger.click();
  await dialog.getByRole("button", { name: "Remove saved copy", exact: true }).click();
  await expect(dialog).toBeHidden();
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(
      page.getByText("Saved copy removed to free up space.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(0);
    const panel = page.getByRole("region", { name: "Transcription", exact: true });
    await expect(panel.getByText("Zażółć gęślą jaźń.")).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Go to / })).toHaveCount(0);
    await more.click();
    await expect(page.getByRole("menuitem", { name: "Rename recording" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Save a copy" })).toHaveCount(0);
    await expect(removeTrigger).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /^Transcribe again/u })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Export transcript", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^Download TXT/u }).click();
  const path = testInfo.outputPath("removed-copy.txt");
  await (await downloadPromise).saveAs(path);
  expect(readFileSync(path, "utf8")).toBe(plainText);
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: `Open ${recording.title}`, exact: true }) }),
  ).toContainText("Saved copy removed");
});
