import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { expect, test as base, type APIRequestContext } from "@playwright/test";
import { openDatabase } from "../../src/server/db/database.ts";
import { createApp } from "../../src/server/http/app.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { createModels } from "../../src/server/models/models.ts";
import { createTranscriptions } from "../../src/server/transcriptions/jobs.ts";
import type { MediaItem } from "../../src/shared/contracts/media.ts";
import type { TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { serveBrowserApp } from "../helpers/browser-server.ts";
import { timedWords } from "../helpers/timed-words.ts";

async function upload(request: APIRequestContext, origin: string, fixture: string, name: string) {
  const uploaded = await request.post(`${origin}/api/media`, {
    data: readFileSync(new URL(`../fixtures/${fixture}`, import.meta.url)),
    headers: { "x-file-name": encodeURIComponent(name) },
  });
  expect(uploaded.status()).toBe(201);
  const item: MediaItem = await uploaded.json();
  return item;
}

const test = base.extend<{ library: { origin: string; meeting: MediaItem } }>({
  library: async ({ request }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-browser-search-"));
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
                    ...timedWords(0, 900, "Źródło budżetu jest jasne."),
                    ...timedWords(1000, 1900, "Plan spotkania na jutro."),
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
              const meeting = await upload(request, origin, "tone.wav", "Łódź meeting.wav");
              await upload(request, origin, "sample.webm", "Budget review.webm");
              const statusUrl = `${origin}/api/media/${meeting.id}/transcription`;
              expect((await request.post(statusUrl)).status()).toBe(202);
              await expect
                .poll(async () => {
                  const job: TranscriptionJob = await (await request.get(statusUrl)).json();
                  return job.status;
                })
                .toBe("completed");
              await use({ origin, meeting });
            });
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
});

test("searches transcripts, opens a matching passage and restores the search on return", async ({
  page,
  library,
}) => {
  await page.goto(library.origin);
  const results = page.getByRole("region", { name: "Media library" });
  const titles = results.getByRole("link", { name: /^Open / });
  await expect(titles).toHaveCount(2);
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("SPOTKAN");
  await expect(page).toHaveURL(/\?q=SPOTKAN$/u);
  await expect(page.getByRole("status").filter({ hasText: "recording" })).toHaveText(
    "1 recording · sorted by best match",
  );
  const matches = page.getByRole("list", { name: "Matches in Łódź meeting" });
  const passage = matches.getByRole("link", { name: /^0:01 ?Plan spotkania na jutro\.$/u });
  await expect(passage.locator("mark")).toHaveText("spotkania");
  await passage.click();
  await expect(page).toHaveURL(`${library.origin}/media/${library.meeting.id}?startMs=1000`);
  await expect
    .poll(() => page.locator("audio").evaluate((player: HTMLMediaElement) => player.currentTime))
    .toBeCloseTo(1, 1);
  await expect(
    page.getByRole("list", { name: "Timestamped passages" }).locator('[aria-current="time"]'),
  ).toContainText("Plan spotkania na jutro.");
  await page.goBack();
  await expect(search).toHaveValue("SPOTKAN");
  await expect(titles).toHaveText([/Łódź meeting/u]);
  await search.fill("lodz");
  await expect(page).toHaveURL(/\?q=lodz$/u);
  await expect(results.getByRole("link", { name: "Open Łódź meeting" }).locator("mark")).toHaveText(
    "Łódź",
  );
});

test("keeps filters and order in the URL and recovers from an empty result", async ({
  page,
  library,
}) => {
  await page.goto(library.origin);
  const results = page.getByRole("region", { name: "Media library" });
  const titles = results.getByRole("link", { name: /^Open / });
  const type = page.getByRole("group", { name: "Type" });
  const transcript = page.getByRole("group", { name: "Transcript" });
  await expect(titles).toHaveText([/Budget review/u, /Łódź meeting/u]);
  await page.getByRole("button", { name: "Sort by Newest" }).click();
  await page.getByRole("menuitemradio", { name: "Oldest" }).click();
  await expect(titles).toHaveText([/Łódź meeting/u, /Budget review/u]);
  await transcript.getByRole("button", { name: "Not yet" }).click();
  await expect(page).toHaveURL(/sort=oldest/u);
  await expect(page).toHaveURL(/transcript=missing/u);
  await page.reload();
  await expect(transcript.getByRole("button", { name: "Not yet" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(titles).toHaveText([/Budget review/u]);
  await type.getByRole("button", { name: "Audio" }).click();
  await expect(
    page.getByRole("heading", { name: "No untranscribed audio recordings match these filters" }),
  ).toBeVisible();
  await page.goBack();
  await expect(type.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await expect(titles).toHaveText([/Budget review/u]);
  await type.getByRole("button", { name: "Audio" }).click();
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(page).toHaveURL(`${library.origin}/`);
  await expect(transcript.getByRole("button", { name: "Any" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(titles).toHaveCount(2);
  await page.goto(`${library.origin}/?kind=image&q=123&sort=size`);
  await expect(titles).toHaveCount(2);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("searchbox", { name: "Search" }).fill("plan");
  await expect(titles).toHaveText([/Łódź meeting/u]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
