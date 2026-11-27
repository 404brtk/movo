import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Schema } from "effect";
import { expect, it } from "vitest";
import { RecordingOverview } from "../../../../src/shared/contracts/overview.ts";
import type { TranscriptWord } from "../../../../src/shared/contracts/transcriptions.ts";
import { aiConnections, askSettings } from "../../../../src/server/ask/ask.schema.ts";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createApp } from "../../../../src/server/http/app.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { mediaItems } from "../../../../src/server/media/media.schema.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import {
  recordingChapters,
  recordingOverviews,
} from "../../../../src/server/overview/overview.schema.ts";
import { createOverviews, type Overviews } from "../../../../src/server/overview/overviews.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const api = "http://127.0.0.1:4310/api";
const audioPath = new URL("../../../fixtures/tone.wav", import.meta.url);
const words: TranscriptWord[] = [
  ...timedWords(0, 3000, "Welcome to the quarterly planning meeting."),
  ...timedWords(130_000, 134_000, "The budget for hiring grows next year."),
  ...timedWords(400_000, 404_000, "Questions from the team close the meeting."),
];
const overviewAnswer = JSON.stringify({
  summary: "The team agrees to grow the hiring budget. Anna leads the planning.",
  keyPoints: [
    { startMs: 130_500, text: "The hiring budget grows next year" },
    { startMs: 0, text: "The meeting opens with the plan" },
  ],
  chapters: [
    { startMs: 0, title: "Opening" },
    { startMs: 130_000, title: "Hiring budget" },
    { startMs: 400_000, title: "Questions" },
  ],
});

type Generate = (options: LanguageModelV4CallOptions) => Promise<string>;

const promptText = (options: LanguageModelV4CallOptions) => JSON.stringify(options.prompt);
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function withOverviews(
  generate: Generate,
  run: (context: {
    request: (path: string, init?: RequestInit) => Promise<Response>;
    overview: () => Promise<RecordingOverview>;
    settled: () => Promise<RecordingOverview>;
    mediaId: string;
    database: AppDatabase;
    overviews: Overviews;
    directory: string;
    library: ReturnType<typeof createMediaLibrary>;
  }) => Promise<void>,
  { contextTokens = 100_000, transcriptWords = words, connect = true, durationSeconds = 500 } = {},
) {
  return async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-overview-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(join(directory, "app.sqlite"));
            const config = { dataDirectory: directory };
            const tools = createMediaTools(config);
            const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
            const transcriptions = createTranscriptions(database, config, tools, {
              check: () => Effect.void,
              transcribe: () => Effect.succeed({ language: "en", words: transcriptWords }),
            });
            const overviews = createOverviews(
              database,
              { library, transcriptions },
              {
                languageModel: () =>
                  new MockLanguageModelV4({
                    doGenerate: async (options) => ({
                      content: [{ type: "text", text: await generate(options) }],
                      finishReason: { unified: "stop", raw: undefined },
                      usage: {
                        inputTokens: {
                          total: 10,
                          noCache: 10,
                          cacheRead: undefined,
                          cacheWrite: undefined,
                        },
                        outputTokens: { total: 10, text: 10, reasoning: undefined },
                      },
                      warnings: [],
                    }),
                  }),
              },
            );
            if (connect) {
              database
                .insert(aiConnections)
                .values({
                  id: "connection",
                  kind: "anthropic",
                  baseUrl: null,
                  apiKey: "sk-test",
                  createdAt: 1,
                  verifiedAt: 1,
                })
                .run();
              database
                .insert(askSettings)
                .values({
                  id: 1,
                  connectionId: "connection",
                  modelId: "model-a",
                  modelName: "Model A",
                  contextTokens,
                })
                .run();
            }
            const audio = readFileSync(audioPath);
            const media = yield* library.import(new Response(audio).body, "plan.wav", audio.length);
            database
              .update(mediaItems)
              .set({ durationSeconds })
              .where(eq(mediaItems.id, media.id))
              .run();
            yield* transcriptions.enqueue(media.id);
            const worker = yield* transcriptions.start();
            const app = createApp(database, config, undefined, {
              tools,
              transcriptions,
              overviews,
            });
            const request = (path: string, init?: RequestInit) =>
              Promise.resolve(app.request(`${api}${path}`, init));
            const overview = async () =>
              Schema.decodeUnknownSync(RecordingOverview)(
                await (await request(`/media/${media.id}/overview`)).json(),
              );
            const settled = async () => {
              await expect.poll(async () => (await overview()).writing).toBeNull();
              return overview();
            };
            yield* Effect.promise(async () => {
              await expect
                .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
                .toBe("completed");
              await run({
                request,
                overview,
                settled,
                mediaId: media.id,
                database,
                overviews,
                directory,
                library,
              });
            });
            yield* overviews.close();
            yield* Fiber.interrupt(worker);
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };
}

it(
  "writes the summary, key points and chapters in the background and makes them searchable but leaves them out of the transcript export",
  withOverviews(
    async () => overviewAnswer,
    async ({ request, mediaId, settled }) => {
      const started = await request(`/media/${mediaId}/overview/write`, json({ scope: "all" }));
      expect(started.status).toBe(202);
      expect(Schema.decodeUnknownSync(RecordingOverview)(await started.json()).writing).toEqual({
        scope: "all",
        part: null,
        parts: null,
      });
      const written = await settled();
      expect(written.summary).toMatchObject({
        text: "The team agrees to grow the hiring budget. Anna leads the planning.",
        source: "model",
        modelName: "Model A",
        keyPoints: [
          { startMs: 0, text: "The meeting opens with the plan" },
          { startMs: 130_000, text: "The hiring budget grows next year" },
        ],
      });
      expect(written.chapters.map(({ startMs, title }) => [startMs, title])).toEqual([
        [0, "Opening"],
        [130_000, "Hiring budget"],
        [400_000, "Questions"],
      ]);
      expect(written).toMatchObject({ chaptersSource: "model", stale: null, failure: null });
      const found = await (await request("/media?q=agrees")).json();
      expect(found).toMatchObject({ items: [{ id: mediaId }] });
      const exported = await (await request(`/media/${mediaId}/transcription/export/txt`)).text();
      expect(exported).toMatch(/^Welcome to the quarterly planning meeting\./u);
      expect(exported).not.toContain("The team agrees");
      const conflict = await request(`/media/${mediaId}/overview/write`, json({ scope: "bad" }));
      expect(conflict.status).toBe(400);
    },
  ),
);

it("reads a transcript that does not fit the model in parts and records the progress", async () => {
  const partsSeen: (number | null)[] = [];
  let database: AppDatabase | undefined;
  let mediaId = "";
  const longWords = Array.from({ length: 60 }, (_, index) =>
    timedWords(
      index * 70_000,
      index * 70_000 + 4000,
      `Topic number ${index} is discussed here at length today.`,
    ),
  ).flat();
  await withOverviews(
    async (options) => {
      const prompt = promptText(options);
      if (prompt.includes("Instruction:")) {
        partsSeen.push(
          database
            ?.select({ parts: recordingOverviews.writingParts })
            .from(recordingOverviews)
            .where(eq(recordingOverviews.mediaId, mediaId))
            .get()?.parts ?? null,
        );
        return "Topics are discussed [0]";
      }
      expect(prompt).toContain("<notes>");
      return overviewAnswer;
    },
    async (context) => {
      database = context.database;
      mediaId = context.mediaId;
      await context.request(`/media/${mediaId}/overview/write`, json({ scope: "summary" }));
      const written = await context.settled();
      expect(written.summary?.text).toContain("hiring budget");
      expect(written.chapters).toEqual([]);
      expect(partsSeen.length).toBeGreaterThan(1);
      expect(partsSeen.every((parts) => parts !== null && parts > 1)).toBe(true);
    },
    { contextTokens: 300, transcriptWords: longWords, durationSeconds: 4300 },
  )();
});

it("keeps the previous summary when the model answers in the wrong format", async () => {
  let answer = overviewAnswer;
  await withOverviews(
    async () => answer,
    async ({ request, mediaId, settled }) => {
      await request(`/media/${mediaId}/overview/write`, json({ scope: "all" }));
      await settled();
      answer = "I cannot help with that.";
      await request(`/media/${mediaId}/overview/write`, json({ scope: "summary" }));
      const failed = await settled();
      expect(failed.failure).toEqual({
        scope: "summary",
        kind: "other",
        message:
          "The model's answer wasn't in the expected format. Try again, or choose another model in Ask.",
      });
      expect(failed.summary?.text).toContain("hiring budget");
      expect(failed.chapters).toHaveLength(3);
    },
  )();
});

it(
  "stops writing without a failure and recovers writing interrupted by a restart",
  withOverviews(
    (options) =>
      new Promise((_resolve, reject) => {
        const signal = options.abortSignal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
    async ({ request, mediaId, overview, database, overviews }) => {
      await request(`/media/${mediaId}/overview/write`, json({ scope: "all" }));
      const busy = await request(`/media/${mediaId}/overview/write`, json({ scope: "all" }));
      expect(busy.status).toBe(409);
      const stopped = Schema.decodeUnknownSync(RecordingOverview)(
        await (await request(`/media/${mediaId}/overview/stop`, { method: "POST" })).json(),
      );
      expect(stopped).toMatchObject({ writing: null, failure: null, summary: null });
      database
        .update(recordingOverviews)
        .set({ writingScope: "summary" })
        .where(eq(recordingOverviews.mediaId, mediaId))
        .run();
      await Effect.runPromise(overviews.recover());
      expect(await overview()).toMatchObject({
        writing: null,
        failure: {
          message: "Movo stopped before the summary was finished. Try again.",
          kind: "other",
        },
      });
    },
  ),
);

it(
  "refuses to write without a connected model",
  withOverviews(
    async () => overviewAnswer,
    async ({ request, mediaId }) => {
      const refused = await request(`/media/${mediaId}/overview/write`, json({ scope: "all" }));
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        error: "Connect a model to write a summary, key points and chapters for this recording.",
      });
    },
    { connect: false },
  ),
);

it(
  "counts transcript changes made after the summary and notices a new transcription",
  withOverviews(
    async () => overviewAnswer,
    async ({ request, mediaId, settled, overview }) => {
      await request(`/media/${mediaId}/overview/write`, json({ scope: "summary" }));
      await settled();
      for (const text of ["Hello", "Hello again"]) {
        const job = await (await request(`/media/${mediaId}/transcription`)).json();
        const edited = await request(
          `/media/${mediaId}/transcription/edit`,
          json({ revision: job.revision, firstWord: 0, wordCount: 1, text }),
        );
        expect(edited.status).toBe(200);
      }
      expect((await overview()).stale).toEqual({ changes: 2 });
      expect(
        (await request(`/media/${mediaId}/transcription/retry`, { method: "POST" })).status,
      ).toBe(202);
      await expect.poll(async () => (await overview()).stale).toEqual({ changes: null });
    },
  ),
);

it(
  "edits, deletes and restores chapters and the summary by hand",
  withOverviews(
    async () => overviewAnswer,
    async ({ request, mediaId, overview }) => {
      const create = (body: unknown) => request(`/media/${mediaId}/chapters`, json(body));
      const first = await create({ startMs: 0, title: "  Opening  " });
      expect(first.status).toBe(201);
      const second = Schema.decodeUnknownSync(RecordingOverview)(
        await (await create({ startMs: 1000, title: "Budget" })).json(),
      );
      expect(second).toMatchObject({ chaptersSource: "manual" });
      expect(second.chapters.map(({ title }) => title)).toEqual(["Opening", "Budget"]);
      const duplicate = await create({ startMs: 1000, title: "Again" });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toEqual({ error: "Another chapter already starts at 0:01." });
      expect((await create({ startMs: 600_000, title: "Outside" })).status).toBe(400);
      expect((await create({ startMs: 100, title: "  " })).status).toBe(400);
      expect((await create({ startMs: 100, title: "Line\nbreak" })).status).toBe(400);
      const budget = second.chapters[1];
      if (!budget) throw new Error("The chapter was not created.");
      const renamed = await request(
        `/media/${mediaId}/chapters/${budget.id}`,
        json({ title: "Hiring budget", startMs: 1500 }, "PATCH"),
      );
      expect((await renamed.json()).chapters[1]).toEqual({
        id: budget.id,
        startMs: 1500,
        title: "Hiring budget",
      });
      expect(
        (await request(`/media/${mediaId}/chapters/${budget.id}`, json({}, "PATCH"))).status,
      ).toBe(400);
      await request(`/media/${mediaId}/chapters/${budget.id}`, { method: "DELETE" });
      expect((await overview()).chapters).toHaveLength(1);
      await create({ id: budget.id, startMs: 1500, title: "Hiring budget" });
      expect((await overview()).chapters[1]?.id).toBe(budget.id);
      await request(`/media/${mediaId}/chapters`, { method: "DELETE" });
      expect(await overview()).toMatchObject({ chapters: [], chaptersSource: null });
      const edited = await request(
        `/media/${mediaId}/summary`,
        json(
          {
            text: "Hand written gist. More detail.",
            keyPoints: [{ startMs: 500, text: "A point" }],
          },
          "PUT",
        ),
      );
      expect(edited.status).toBe(200);
      expect((await overview()).summary).toMatchObject({
        text: "Hand written gist. More detail.",
        source: "edited",
        modelName: null,
        keyPoints: [{ startMs: 500, text: "A point" }],
      });
      expect(
        (
          await request(
            `/media/${mediaId}/summary`,
            json({ text: "Gist.", keyPoints: [{ startMs: 600_000, text: "Too late" }] }, "PUT"),
          )
        ).status,
      ).toBe(400);
      expect((await (await request("/media?q=hand")).json()).items).toHaveLength(1);
      await request(`/media/${mediaId}/summary`, { method: "DELETE" });
      expect((await overview()).summary).toBeNull();
      expect((await (await request("/media?q=hand")).json()).items).toHaveLength(0);
    },
  ),
);

it(
  "removes the overview with the recording",
  withOverviews(
    async () => overviewAnswer,
    async ({ request, mediaId, database }) => {
      await request(`/media/${mediaId}/chapters`, json({ startMs: 0, title: "Opening" }));
      expect((await request(`/media/${mediaId}`, { method: "DELETE" })).status).toBe(200);
      expect(database.select().from(recordingChapters).all()).toEqual([]);
      expect(database.select().from(recordingOverviews).all()).toEqual([]);
    },
  ),
);

it(
  "saves chapters from the source site together with a downloaded recording",
  withOverviews(
    async () => overviewAnswer,
    async ({ directory, library, overviews }) => {
      const adopt = async (chapters?: { start_time: number; title?: string | null }[]) => {
        const id = randomUUID();
        const staging = join(directory, "downloads", id);
        await mkdir(staging, { recursive: true });
        await copyFile(audioPath, join(staging, "media.wav"));
        return Effect.runPromise(
          library.adoptDownload(
            join(staging, "media.wav"),
            "Downloaded",
            { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", preset: "audio" },
            id,
            chapters,
          ),
        );
      };
      const withChapters = await adopt([
        { start_time: 1, title: "Second part" },
        { start_time: 0, title: "Intro" },
        { start_time: 60, title: "Past the end" },
      ]);
      expect(await Effect.runPromise(overviews.get(withChapters.id))).toMatchObject({
        chaptersSource: "site",
        chapters: [
          { startMs: 0, title: "Intro" },
          { startMs: 1000, title: "Second part" },
        ],
      });
      const without = await adopt();
      expect(await Effect.runPromise(overviews.get(without.id))).toMatchObject({
        chaptersSource: null,
        chapters: [],
      });
    },
  ),
);
