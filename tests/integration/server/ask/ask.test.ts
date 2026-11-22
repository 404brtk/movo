import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Effect, Fiber, Predicate, Schema } from "effect";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import {
  AiConnection,
  AiConnectionList,
  ChatDetail,
  type AiModel,
} from "../../../../src/shared/contracts/ask.ts";
import { chatMessages } from "../../../../src/server/ask/ask.schema.ts";
import { createAsk, type AskBoundaries } from "../../../../src/server/ask/ask.ts";
import { languageModel } from "../../../../src/server/ask/providers.ts";
import { openDatabase, type AppDatabase } from "../../../../src/server/db/database.ts";
import { createDownloads } from "../../../../src/server/downloads/jobs.ts";
import { createApp } from "../../../../src/server/http/app.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const api = "http://127.0.0.1:4310/api/ask";
const validKey = "sk-test-key-1234";
const models: AiModel[] = [
  { id: "model-a", name: "Model A", contextTokens: 100_000, tools: "yes" },
];
const words = [
  ...timedWords(0, 500, "The budget meeting starts."),
  ...timedWords(600, 1100, "Anna presents the numbers."),
];

const usage = () => ({
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
});
const finish = (unified: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified, raw: undefined },
  usage: usage(),
});
const text = (value: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: value },
  { type: "text-end", id: "t" },
  finish("stop"),
];
const call = (toolName: string, input: unknown): LanguageModelV4StreamPart[] => [
  { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
  finish("tool-calls"),
];
const stream = (chunks: LanguageModelV4StreamPart[]) => ({
  stream: simulateReadableStream({ chunks }),
});

type Respond = (
  options: LanguageModelV4CallOptions,
  call: number,
  ids: { mediaId: string; otherMediaId: string; revision: number },
) => ReturnType<typeof stream>;

function json(body: unknown, method = "POST") {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function withAsk(
  respond: Respond,
  run: (context: {
    request: (path: string, init?: RequestInit) => Promise<Response>;
    mediaId: string;
    otherMediaId: string;
    transcript: () => Promise<string>;
    calls: LanguageModelV4CallOptions[];
    generated: LanguageModelV4CallOptions[];
    database: AppDatabase;
  }) => Promise<void>,
  modelOverride?: AskBoundaries["languageModel"],
  fixtureWords = words,
) {
  return async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-ask-"));
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
              transcribe: () => Effect.succeed({ language: "en", words: fixtureWords }),
            });
            const downloads = createDownloads(database, config, tools, {
              preview: (url) => Effect.succeed({ url, title: "A source", durationSeconds: 2 }),
              download: () => Effect.never,
            });
            const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
            const media = yield* library.import(
              new Response(audio).body,
              "meeting.wav",
              audio.length,
            );
            const other = yield* library.import(
              new Response(audio).body,
              "other.wav",
              audio.length,
            );
            yield* transcriptions.enqueue(media.id);
            const worker = yield* transcriptions.start();
            let counter = 0;
            const calls: LanguageModelV4CallOptions[] = [];
            const generated: LanguageModelV4CallOptions[] = [];
            const boundaries: AskBoundaries = {
              listModels: async (connection) => {
                if (connection.apiKey !== validKey && connection.kind !== "server")
                  throw new MediaError(
                    "invalid",
                    "Anthropic rejected this key. Check it and try again.",
                  );
                return models;
              },
              detectLocalServers: async () => [],
              languageModel:
                modelOverride ??
                (() =>
                  new MockLanguageModelV4({
                    doStream: async (options) => {
                      calls.push(options);
                      const revision =
                        (await Effect.runPromise(transcriptions.get(media.id)))?.revision ?? 0;
                      return respond(options, counter++, {
                        mediaId: media.id,
                        otherMediaId: other.id,
                        revision,
                      });
                    },
                    doGenerate: async (options) => {
                      generated.push(options);
                      return {
                        content: [{ type: "text", text: "The budget meeting starts [0]." }],
                        finishReason: { unified: "stop", raw: undefined },
                        usage: usage(),
                        warnings: [],
                      };
                    },
                  })),
            };
            const ask = yield* Effect.acquireRelease(
              Effect.sync(() =>
                createAsk(database, { library, downloads, transcriptions }, boundaries),
              ),
              (service) => service.close(),
            );
            const app = createApp(database, config, undefined, { tools, transcriptions, ask });
            yield* Effect.promise(async () => {
              await expect
                .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
                .toBe("completed");
              await run({
                request: (path, init) => Promise.resolve(app.request(`${api}${path}`, init)),
                mediaId: media.id,
                otherMediaId: other.id,
                transcript: async () =>
                  (await Effect.runPromise(transcriptions.get(media.id)))?.transcript?.words
                    .map((word) => word.text)
                    .join(" ") ?? "",
                calls,
                generated,
                database,
              });
            });
            yield* Fiber.interrupt(worker);
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };
}

async function connectAndCreateChat(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  mediaId: string | null,
  scope: unknown = null,
  { kind = "anthropic", modelId = "model-a", contextTokens = 100_000 } = {},
) {
  const connection = Schema.decodeUnknownSync(AiConnection)(
    await (await request("/connections", json({ kind, apiKey: validKey }))).json(),
  );
  expect(
    (
      await request(
        "/default",
        json(
          {
            connectionId: connection.id,
            modelId,
            modelName: "Model A",
            contextTokens,
          },
          "PUT",
        ),
      )
    ).status,
  ).toBe(200);
  const created = await request("/chats", json({ mediaId, scope }));
  expect(created.status).toBe(201);
  return Schema.decodeUnknownSync(ChatDetail)(await created.json()).chat.id;
}

async function settled(request: (path: string) => Promise<Response>, chatId: string) {
  let detail: ChatDetail | undefined;
  await expect
    .poll(async () => {
      detail = Schema.decodeUnknownSync(ChatDetail)(
        await (await request(`/chats/${chatId}`)).json(),
      );
      return detail.messages.at(-1)?.state;
    })
    .not.toBe("answering");
  if (!detail) throw new Error("The chat was not read.");
  return detail;
}

it(
  "keeps keys on the server, accepts only local and home-network servers and requires a model before chatting",
  withAsk(
    () => stream(text("unused")),
    async ({ request, mediaId }) => {
      const rejected = await request(
        "/connections",
        json({ kind: "anthropic", apiKey: "sk-wrong-key" }),
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: "Anthropic rejected this key. Check it and try again.",
      });
      expect((await request("/chats", json({ mediaId }))).status).toBe(409);
      const connected = await request(
        "/connections",
        json({ kind: "anthropic", apiKey: validKey }),
      );
      expect(connected.status).toBe(201);
      const body = await connected.text();
      expect(body).not.toContain(validKey);
      expect(Schema.decodeUnknownSync(AiConnection)(JSON.parse(body)).keyHint).toBe("1234");

      const internet = await request(
        "/connections",
        json({ kind: "server", baseUrl: "http://8.8.8.8:11434" }),
      );
      expect(internet.status).toBe(400);
      const home = await request(
        "/connections",
        json({ kind: "server", baseUrl: "192.168.1.20:11434/v1/" }),
      );
      expect(Schema.decodeUnknownSync(AiConnection)(await home.json())).toMatchObject({
        baseUrl: "http://192.168.1.20:11434",
        reach: "network",
        keyHint: null,
      });
      const list = Schema.decodeUnknownSync(AiConnectionList)(
        await (await request("/connections")).json(),
      );
      expect(list.map((connection) => connection.kind)).toEqual(["anthropic", "server"]);
      expect((await request(`/connections/${list[1]?.id}`, { method: "DELETE" })).status).toBe(200);
      expect(await (await request(`/connections/${list[0]?.id}/models`)).json()).toEqual(models);
    },
  ),
);

it(
  "answers from the transcript with tools limited to the chat's recording",
  withAsk(
    (_options, index, { otherMediaId }) => {
      if (index === 0) return stream(call("read_transcript", { mediaId: otherMediaId }));
      if (index === 1)
        return stream(call("search_library", { q: "budget", kind: null, limit: null }));
      return stream(text("Anna presents the numbers at [0] [0:00](/media/x?startMs=600)."));
    },
    async ({ request, mediaId, otherMediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      const responded = (index: number) => {
        const prompt = calls[index]?.prompt ?? [];
        return JSON.stringify(prompt.at(-1));
      };
      const asked = await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
      expect(asked.status).toBe(202);
      const detail = await settled(request, chatId);
      expect(detail.chat.title).toBe("Who presents?");
      expect(detail.messages.map((message) => [message.role, message.state])).toEqual([
        ["user", "done"],
        ["assistant", "done"],
      ]);
      expect(detail.messages[1]?.modelName).toBe("Model A");
      expect(
        detail.messages[1]?.parts.map((part) => (part.type === "tool" ? part.state : part.type)),
      ).toEqual(["failed", "done", "text"]);
      expect(detail.messages[1]?.moments).toEqual([{ startMs: 0, mediaId }]);
      expect(responded(1)).toContain("only use the recording it belongs to");
      expect(responded(2)).toContain("meeting");
      expect(responded(2)).not.toContain(otherMediaId);
      expect(JSON.stringify(calls[0]?.tools?.map((tool) => tool.name))).toBe(
        JSON.stringify([
          "search_library",
          "get_recording",
          "read_transcript",
          "list_transcript_changes",
          "edit_transcript",
          "replace_in_transcript",
          "assign_speaker",
          "merge_speakers",
          "rename_speaker",
        ]),
      );
      expect(JSON.stringify(calls[0]?.prompt.at(-1))).toContain("ephemeral");
    },
  ),
);

const systemTexts = (options: LanguageModelV4CallOptions | undefined) =>
  (options?.prompt ?? []).flatMap((message) =>
    message.role === "system" ? [{ text: message.content, options: message.providerOptions }] : [],
  );

it(
  "gives the model the recording's whole transcript, cached, and links any moment of it",
  withAsk(
    () => stream(text("The meeting opens at [0].")),
    async ({ request, mediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "How does it open?" }));
      const detail = await settled(request, chatId);
      expect(detail.messages[1]).toMatchObject({
        state: "done",
        transcriptReading: "whole",
        moments: [{ startMs: 0, mediaId }],
      });
      expect(calls).toHaveLength(1);
      const [instructions, transcript] = systemTexts(calls[0]);
      expect(instructions?.text).toContain("whole transcript follows");
      expect(instructions?.text).not.toContain("Read in pages");
      expect(transcript?.text).toContain('The whole transcript of "meeting"');
      expect(transcript?.text).toContain("Anna presents the numbers.");
      expect(transcript?.options).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
      expect(calls[0]?.tools).toHaveLength(9);
    },
  ),
);

const contextOverflow = () =>
  new APICallError({
    message: "prompt is too long: 250000 tokens > 199999 maximum",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });

it(
  "reads the transcript in parts when the provider says the whole one is too long",
  withAsk(
    (_options, index) => {
      if (index === 0) throw contextOverflow();
      if (index === 1)
        return stream(call("scan_transcript", { instruction: "Note the main points" }));
      return stream(text("It opens with the budget [0]."));
    },
    async ({ request, mediaId, calls, generated }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "Summarise it" }));
      const detail = await settled(request, chatId);
      expect(detail.messages[1]).toMatchObject({
        state: "done",
        error: null,
        transcriptReading: "parts",
        moments: [{ startMs: 0, mediaId }],
        parts: [
          { type: "tool", toolName: "scan_transcript", state: "done", resultCount: 1 },
          { type: "text", text: "It opens with the budget [0]." },
        ],
      });
      expect(calls).toHaveLength(3);
      expect(systemTexts(calls[0])).toHaveLength(2);
      expect(calls[0]?.tools?.map((tool) => tool.name)).not.toContain("scan_transcript");
      const retried = systemTexts(calls[1]);
      expect(retried).toHaveLength(1);
      expect(retried[0]?.text).toContain("too long for you to hold at once");
      expect(retried[0]?.text).not.toContain("Anna presents the numbers.");
      expect(calls[1]?.tools?.map((tool) => tool.name)).toContain("scan_transcript");
      expect(generated).toHaveLength(1);
      const part = JSON.stringify(generated[0]?.prompt);
      expect(part).toContain("Instruction: Note the main points");
      expect(part).toContain("Anna presents the numbers.");
      expect(JSON.stringify(calls[2]?.prompt.at(-1))).toContain("The budget meeting starts [0].");
      await request(`/chats/${chatId}/messages`, json({ text: "Summarise it again" }));
      expect((await settled(request, chatId)).messages.at(-1)?.transcriptReading).toBe("parts");
      expect(calls).toHaveLength(4);
      expect(systemTexts(calls[3])).toHaveLength(1);
    },
  ),
);

it(
  "reuses the first transcript scan when the model asks to scan again",
  withAsk(
    (_options, index) => {
      if (index === 0) throw contextOverflow();
      if (index < 3) {
        const [scan, finishStep] = call("scan_transcript", { instruction: `Scan ${index}` });
        if (scan?.type !== "tool-call" || !finishStep) throw new Error("Missing scan step.");
        return stream([{ ...scan, toolCallId: `scan-${index}` }, finishStep]);
      }
      return stream(text("The meeting opens at [0]."));
    },
    async ({ request, mediaId, calls, generated }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "Summarise it" }));
      const detail = await settled(request, chatId);
      expect(parts(detail)).toEqual(["done", "done", "text"]);
      expect(generated).toHaveLength(1);
      expect(JSON.stringify(calls[3]?.prompt.at(-1))).toContain("The budget meeting starts [0].");
    },
  ),
);

it(
  "uses parts immediately when the estimated budget cannot hold the whole transcript",
  withAsk(
    () => stream(text("I'll look in parts.")),
    async ({ request, mediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId, null, { contextTokens: 4096 });
      await request(`/chats/${chatId}/messages`, json({ text: "Summarise it" }));
      expect((await settled(request, chatId)).messages.at(-1)?.transcriptReading).toBe("parts");
      expect(calls).toHaveLength(1);
      expect(systemTexts(calls[0])).toHaveLength(1);
    },
    undefined,
    timedWords(0, 1500, "A long recording has many passages of discussion. ".repeat(250).trim()),
  ),
);

it(
  "keeps partial text and does not retry a whole transcript after streaming has started",
  withAsk(
    () =>
      stream([
        ...text("The meeting opens.").slice(0, -1),
        { type: "error", error: contextOverflow() },
      ]),
    async ({ request, mediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "How does it open?" }));
      expect((await settled(request, chatId)).messages.at(-1)).toMatchObject({
        state: "failed",
        parts: [{ type: "text", text: "The meeting opens." }],
      });
      expect(calls).toHaveLength(1);
    },
  ),
);

it(
  "keeps the history cut made by a rejected whole-transcript request",
  withAsk(
    (_options, index) => {
      if (index === 0) throw contextOverflow();
      return stream(text("It opens with a discussion."));
    },
    async ({ request, mediaId, calls, database }) => {
      const chatId = await connectAndCreateChat(request, mediaId, null, { contextTokens: 6000 });
      const earlier = "An earlier question. ".repeat(260);
      database
        .insert(chatMessages)
        .values({
          chatId,
          seq: 1,
          role: "user",
          state: "done",
          createdAt: Date.now(),
          messages: [{ role: "user", content: earlier }],
        })
        .run();
      await request(`/chats/${chatId}/messages`, json({ text: "Summarise it" }));
      const detail = await settled(request, chatId);
      expect(calls).toHaveLength(2);
      expect(systemTexts(calls[0])).toHaveLength(2);
      expect(detail.hiddenBeforeSeq).toBe(2);
      expect(JSON.stringify(calls[1]?.prompt)).not.toContain("An earlier question");
    },
    undefined,
    timedWords(0, 1500, "The budget meeting opens with a discussion. ".repeat(70).trim()),
  ),
);

it(
  "waits for approval before editing and records the change as made by Ask",
  withAsk(
    (_options, index, { mediaId, revision }) => {
      if (index === 0)
        return stream(
          call("replace_in_transcript", { mediaId, revision, find: "Anna", replacement: "Hanna" }),
        );
      return stream(text("Done."));
    },
    async ({ request, mediaId, transcript, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      calls.length = 0;
      await request(`/chats/${chatId}/messages`, json({ text: "Fix the name" }));
      const waiting = await settled(request, chatId);
      expect(waiting.messages[1]?.state).toBe("waiting_approval");
      expect(await transcript()).toContain("Anna");
      const pending = waiting.messages[1]?.parts.find((part) => part.type === "tool");
      if (pending?.type !== "tool" || !pending.approvalId) throw new Error("No approval request.");
      expect(pending.state).toBe("waiting_approval");
      const decided = await request(
        `/chats/${chatId}/approval`,
        json({ approvalId: pending.approvalId, approved: true }),
      );
      expect(decided.status).toBe(202);
      const done = await settled(request, chatId);
      expect(done.messages[1]?.state).toBe("done");
      expect(await transcript()).toContain("Hanna");
      expect(done.messages[1]?.parts.find((part) => part.type === "tool")).toMatchObject({
        state: "done",
        resultCount: 1,
      });
      const history = await (await request(`/../media/${mediaId}/transcription/changes`)).text();
      expect(history).toContain('"source":"chat"');
      expect(
        (
          await request(
            `/chats/${chatId}/approval`,
            json({ approvalId: pending.approvalId, approved: false }),
          )
        ).status,
      ).toBe(409);
    },
  ),
);

it(
  "preserves citations when approvals resume an answer after a passage boundary changed",
  withAsk(
    (_options, index, { mediaId, revision }) => {
      if (index === 0)
        return stream([
          ...text("Anna takes over at [600].").slice(0, -1),
          ...call("edit_transcript", {
            mediaId,
            revision,
            firstWord: 3,
            wordCount: 1,
            text: "starts",
          }),
        ]);
      if (index === 1)
        return stream(
          call("replace_in_transcript", { mediaId, revision, find: "Anna", replacement: "Hanna" }),
        );
      return stream(text("Both changes are applied."));
    },
    async ({ request, mediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "Fix the punctuation and name" }));
      for (const toolName of ["edit_transcript", "replace_in_transcript"]) {
        const waiting = (await settled(request, chatId)).messages.at(-1);
        expect(waiting?.state).toBe("waiting_approval");
        const pending = waiting?.parts.find(
          (part) =>
            part.type === "tool" && part.toolName === toolName && part.state === "waiting_approval",
        );
        if (pending?.type !== "tool" || !pending.approvalId)
          throw new Error("No approval request.");
        const approved = await request(
          `/chats/${chatId}/approval`,
          json({ approvalId: pending.approvalId, approved: true }),
        );
        expect(approved.status).toBe(202);
      }
      const result = (await settled(request, chatId)).messages.at(-1);
      expect(systemTexts(calls[2])[1]?.text).toContain("[0] The budget meeting starts Anna");
      expect(systemTexts(calls[2])[1]?.text).not.toContain("[600]");
      expect(result).toMatchObject({ state: "done", moments: [{ startMs: 600, mediaId }] });
    },
  ),
);

it(
  "stops an answer, keeping its partial text",
  withAsk(
    (options) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Partial answer" });
          options.abortSignal?.addEventListener("abort", () =>
            controller.error(new DOMException("Aborted", "AbortError")),
          );
        },
      }),
    }),
    async ({ request, mediaId }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "Tell me everything" }));
      expect((await request(`/chats/${chatId}/messages`, json({ text: "Again" }))).status).toBe(
        409,
      );
      const live = (await request(`/chats/${chatId}/live`)).body?.getReader();
      if (!live) throw new Error("The live answer has no body.");
      let received = "";
      while (!received.includes("Partial answer")) {
        const chunk = await live.read();
        if (chunk.done) break;
        received += new TextDecoder().decode(chunk.value);
      }
      expect(received).toContain("event: snapshot");
      expect(received).toContain('"Partial answer"');
      const liveDetail = Schema.decodeUnknownSync(ChatDetail)(
        await (await request(`/chats/${chatId}`)).json(),
      );
      expect(liveDetail.messages[1]).toMatchObject({
        state: "answering",
        liveTranscript: true,
        moments: [],
      });
      const stopped = Schema.decodeUnknownSync(ChatDetail)(
        await (await request(`/chats/${chatId}/stop`, { method: "POST" })).json(),
      );
      expect(stopped.messages[1]).toMatchObject({
        state: "stopped",
        error: null,
        parts: [{ type: "text", text: "Partial answer" }],
      });
      expect(new TextDecoder().decode((await live.read()).value)).toContain("event: end");
      await live.cancel();
    },
  ),
);

const parts = (detail: ChatDetail) =>
  detail.messages.at(-1)?.parts.map((part) => (part.type === "tool" ? part.state : part.type));

it(
  "pages library search results within the chat's scope",
  withAsk(
    (_options, index) => {
      if (index === 0) return stream(call("search_library", { q: "", limit: 1, offset: 1 }));
      return stream(text("Two recordings."));
    },
    async ({ request, mediaId, otherMediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, null, {
        mediaIds: [mediaId, otherMediaId],
      });
      await request(`/chats/${chatId}/messages`, json({ text: "What is there?" }));
      expect(parts(await settled(request, chatId))).toEqual(["done", "text"]);
      const result = JSON.stringify(calls[1]?.prompt.at(-1));
      expect(result).toContain('"total":2');
      expect([mediaId, otherMediaId].filter((id) => result.includes(id))).toHaveLength(1);
    },
  ),
);

it(
  "keeps a library chat to the recordings and the kind the user chose",
  withAsk(
    (_options, index, { mediaId }) => {
      if (index === 0) return stream(call("read_transcript", { mediaId }));
      if (index === 1) return stream(call("search_library", { q: "numbers" }));
      if (index === 2) return stream(text("Nothing in those recordings."));
      if (index === 3) return stream(call("get_recording", { mediaId }));
      return stream(text("That is a video-only chat."));
    },
    async ({ request, mediaId, otherMediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, null, { mediaIds: [otherMediaId] });
      await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
      const chosen = await settled(request, chatId);
      expect(chosen.chat.scope).toEqual({ mediaIds: [otherMediaId] });
      expect(parts(chosen)).toEqual(["failed", "done", "text"]);
      expect(chosen.messages[1]?.transcriptReading).toBeNull();
      expect(systemTexts(calls[0])).toHaveLength(1);
      expect(JSON.stringify(calls[1]?.prompt.at(-1))).toContain("outside the chat's scope");
      expect(JSON.stringify(calls[2]?.prompt.at(-1))).toContain('"total":0');
      expect(calls[0]?.tools?.map((tool) => tool.name)).not.toContain("edit_transcript");
      const changed = await request(
        `/chats/${chatId}/scope`,
        json({ scope: { kind: "video" } }, "PUT"),
      );
      expect(Schema.decodeUnknownSync(ChatDetail)(await changed.json()).chat.scope).toEqual({
        kind: "video",
      });
      await request(`/chats/${chatId}/messages`, json({ text: "And now?" }));
      expect(parts(await settled(request, chatId))).toEqual(["failed", "text"]);
      expect(JSON.stringify(calls[3]?.prompt[0])).toContain("video recordings");
      const panel = await connectAndCreateChat(request, mediaId);
      expect(
        (await request(`/chats/${panel}/scope`, json({ scope: { kind: "audio" } }, "PUT"))).status,
      ).toBe(400);
    },
  ),
);

it(
  "sends a selected passage with the question and keeps it apart from the question text",
  withAsk(
    () => stream(text("Anna does, at [600].")),
    async ({ request, mediaId, calls }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      const asked = await request(
        `/chats/${chatId}/messages`,
        json({
          text: "Who is this?",
          passage: { startMs: 600, text: "Anna presents the numbers." },
        }),
      );
      expect(asked.status).toBe(202);
      const detail = await settled(request, chatId);
      expect(detail.messages[0]).toMatchObject({
        passage: { startMs: 600, text: "Anna presents the numbers." },
        parts: [{ type: "text", text: "Who is this?" }],
      });
      expect(JSON.stringify(calls[0]?.prompt.at(-1))).toContain(
        'About the passage at 0:00 (startMs 600): \\"Anna presents the numbers.\\"',
      );
      expect(detail.messages[1]?.moments).toEqual([{ startMs: 600, mediaId }]);
      const listed = await (await request(`/chats?mediaId=${mediaId}`)).json();
      expect(listed).toMatchObject([{ id: chatId, recordingCount: 1 }]);
    },
  ),
);

it(
  "names why an answer failed so the field can offer the fix",
  withAsk(
    () => {
      throw new APICallError({
        message: "invalid x-api-key",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 401,
        isRetryable: false,
      });
    },
    async ({ request, mediaId }) => {
      const chatId = await connectAndCreateChat(request, mediaId);
      await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
      expect((await settled(request, chatId)).messages[1]).toMatchObject({
        state: "failed",
        errorKind: "key",
        error: "Anthropic no longer accepts your key.",
      });
    },
  ),
);

interface Captured {
  path: string;
  body: Record<string, unknown>;
}

async function fakeProvider(reply: { status: number; body: string }) {
  const captured: Captured[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const parsed: unknown = JSON.parse(body || "{}");
      captured.push({
        path: request.url ?? "",
        body: Predicate.isObject(parsed) ? Object.fromEntries(Object.entries(parsed)) : {},
      });
      response.statusCode = reply.status;
      response.setHeader(
        "content-type",
        reply.status === 200 ? "text/event-stream" : "application/json",
      );
      response.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake provider has no port.");
  return { baseUrl: `http://127.0.0.1:${address.port}`, captured };
}

const events = (...items: [string, unknown][]) =>
  items.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const chunks = (...items: unknown[]) =>
  `${items.map((data) => `data: ${JSON.stringify(data)}\n\n`).join("")}data: [DONE]\n\n`;

const anthropicReply = events(
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "model-a",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 20,
          cache_read_input_tokens: 1800,
          cache_creation_input_tokens: 0,
          output_tokens: 1,
        },
      },
    },
  ],
  [
    "content_block_start",
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ],
  [
    "content_block_delta",
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Anna." } },
  ],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  [
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 3 },
    },
  ],
  ["message_stop", { type: "message_stop" }],
);

const chatCompletionReply = chunks(
  {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "model",
    choices: [{ index: 0, delta: { role: "assistant", content: "Anna." }, finish_reason: null }],
  },
  {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 },
  },
);

const sentTo = async (provider: Awaited<ReturnType<typeof fakeProvider>>, path: string) => {
  await expect.poll(() => provider.captured.some((entry) => entry.path === path)).toBe(true);
  return provider.captured.find((entry) => entry.path === path)?.body ?? {};
};
const lastMessage = (body: Record<string, unknown>) =>
  JSON.stringify(Array.isArray(body.messages) ? body.messages.at(-1) : null);
const ephemeral = JSON.stringify({ cache_control: { type: "ephemeral" } }).slice(1, -1);

describe("requests sent to providers", () => {
  const providers: Record<string, Awaited<ReturnType<typeof fakeProvider>>> = {};
  beforeEach(async () => {
    providers.anthropic = await fakeProvider({ status: 200, body: anthropicReply });
    providers.openrouter = await fakeProvider({ status: 200, body: chatCompletionReply });
    providers.openai = await fakeProvider({
      status: 400,
      body: JSON.stringify({ error: { message: "overloaded" } }),
    });
    providers.server = await fakeProvider({ status: 200, body: chatCompletionReply });
  });
  const provider = (name: string) => {
    const found = providers[name];
    if (!found) throw new Error(`No fake ${name} provider.`);
    return found;
  };

  it(
    "marks Anthropic's cache breakpoint on the latest message and stores input tokens including cache reads",
    withAsk(
      () => stream(text("unused")),
      async ({ request, mediaId, database }) => {
        const chatId = await connectAndCreateChat(request, mediaId);
        await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
        expect((await settled(request, chatId)).messages[1]?.state).toBe("done");
        const sent = await sentTo(provider("anthropic"), "/v1/messages");
        expect(lastMessage(sent)).toContain(ephemeral);
        const system = Array.isArray(sent.system) ? sent.system : [];
        expect(system).toHaveLength(2);
        expect(JSON.stringify(system[0])).not.toContain("cache_control");
        expect(JSON.stringify(system[1])).toContain("Anna presents the numbers.");
        expect(JSON.stringify(system[1])).toContain(ephemeral);
        expect(JSON.stringify(sent.tools)).toContain("read_transcript");
        const stored = database
          .select({ inputTokens: chatMessages.inputTokens })
          .from(chatMessages)
          .all()
          .find((row) => row.inputTokens !== null);
        expect(stored?.inputTokens).toBe(1820);
      },
      (_connection, modelId) =>
        createAnthropic({ apiKey: validKey, baseURL: `${provider("anthropic").baseUrl}/v1` })(
          modelId,
        ),
    ),
  );

  it(
    "marks OpenRouter's cache breakpoint for Anthropic models on the question",
    withAsk(
      () => stream(text("unused")),
      async ({ request, mediaId }) => {
        const chatId = await connectAndCreateChat(request, mediaId, null, {
          kind: "openrouter",
          modelId: "anthropic/claude-sonnet",
        });
        await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
        expect((await settled(request, chatId)).messages[1]?.state).toBe("done");
        const sent = await sentTo(provider("openrouter"), "/chat/completions");
        expect(sent.model).toBe("anthropic/claude-sonnet");
        expect(lastMessage(sent)).toContain(ephemeral);
        const transcript = Array.isArray(sent.messages) ? sent.messages[1] : null;
        expect(JSON.stringify(transcript)).toContain("Anna presents the numbers.");
        expect(JSON.stringify(transcript)).toContain(ephemeral);
      },
      (_connection, modelId) =>
        createOpenRouter({ apiKey: validKey, baseURL: provider("openrouter").baseUrl })(modelId),
    ),
  );

  it(
    "sends OpenAI non-strict tool schemas whose optional fields allow null",
    withAsk(
      () => stream(text("unused")),
      async ({ request, mediaId }) => {
        const chatId = await connectAndCreateChat(request, mediaId, null, { kind: "openai" });
        await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
        expect((await settled(request, chatId)).messages[1]).toMatchObject({
          errorKind: "other",
          error: "OpenAI didn't answer: overloaded",
        });
        const sent = await sentTo(provider("openai"), "/responses");
        const tools = Array.isArray(sent.tools) ? sent.tools : [];
        expect(tools).toHaveLength(9);
        expect(tools.every((entry) => Predicate.isObject(entry) && entry.strict === false)).toBe(
          true,
        );
        expect(JSON.stringify(tools)).toContain(JSON.stringify({ type: "null" }));
        expect(JSON.stringify(sent.input)).not.toContain("cache_control");
      },
      (_connection, modelId) =>
        createOpenAI({ apiKey: validKey, baseURL: provider("openai").baseUrl })(modelId),
    ),
  );

  it(
    "talks to an own server through its OpenAI-compatible chat API with the tools",
    withAsk(
      () => stream(text("unused")),
      async ({ request, mediaId }) => {
        const chatId = await connectAndCreateChat(request, mediaId);
        await request(`/chats/${chatId}/messages`, json({ text: "Who presents?" }));
        expect((await settled(request, chatId)).messages[1]?.state).toBe("done");
        const sent = await sentTo(provider("server"), "/v1/chat/completions");
        expect(JSON.stringify(sent.tools)).toContain("search_library");
        expect(lastMessage(sent)).not.toContain("cache_control");
      },
      (_connection, modelId) =>
        languageModel(
          { kind: "server", baseUrl: provider("server").baseUrl, apiKey: null },
          modelId,
        ),
    ),
  );
});
