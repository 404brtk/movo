import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Schema } from "effect";
import { expect, it } from "vitest";
import {
  TranscriptionJob,
  type Transcript,
} from "../../../../src/shared/contracts/transcriptions.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createMediaLibrary } from "../../../../src/server/media/library.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createTranscriptions } from "../../../../src/server/transcriptions/jobs.ts";
import { createApp } from "../../../../src/server/http/app.ts";

it("runs transcription beyond the initiating request and exposes status, cancel and retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-transcription-http-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const config = { dataDirectory: directory };
          const tools = createMediaTools(config);
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
          const media = yield* library.import(
            new Response(audio).body,
            "recording.wav",
            audio.length,
          );
          let complete = false;
          const transcriptions = createTranscriptions(database, config, tools, {
            check: () => Effect.void,
            transcribe: () =>
              complete ? Effect.succeed({ language: null, segments: [] }) : Effect.never,
          });
          const app = createApp(database, config, undefined, { tools, transcriptions });
          const worker = yield* transcriptions.start();
          const base = `http://127.0.0.1:4310/api/media/${media.id}/transcription`;
          yield* Effect.promise(async () => {
            const initial = await app.request(base);
            expect(initial.status).toBe(200);
            expect(initial.headers.get("cache-control")).toBe("no-store");
            expect(await initial.json()).toBeNull();
            expect(
              (await app.request("http://127.0.0.1:4310/api/media/invalid/transcription")).status,
            ).toBe(404);
            const controller = new AbortController();
            const response = await app.request(base, { method: "POST", signal: controller.signal });
            expect(response.status).toBe(202);
            expect(Schema.decodeUnknownSync(TranscriptionJob)(await response.json()).mediaId).toBe(
              media.id,
            );
            controller.abort();
            expect(
              (await app.request(base.replace("/transcription", ""), { method: "DELETE" })).status,
            ).toBe(409);
            await expect
              .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
              .toBe("running");
            expect((await app.request(`${base}/export/txt`)).status).toBe(400);
            expect((await app.request(`${base}/retry`, { method: "POST" })).status).toBe(400);
            expect((await app.request(`${base}/cancel`, { method: "POST" })).status).toBe(200);
            expect((await Effect.runPromise(transcriptions.get(media.id)))?.status).toBe(
              "cancelled",
            );
            expect((await app.request(`${base}/export/txt`)).status).toBe(400);
            complete = true;
            expect((await app.request(`${base}/retry`, { method: "POST" })).status).toBe(202);
            await expect
              .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
              .toBe("completed");
            expect(
              Schema.decodeUnknownSync(TranscriptionJob)(await (await app.request(base)).json())
                .transcript,
            ).toEqual({ language: null, segments: [] });
            expect(await (await app.request(`${base}/export/vtt`)).text()).toBe("WEBVTT\n\n");
          });
          yield* Fiber.interrupt(worker);
        }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

it("downloads completed transcripts as UTF-8 attachments without starting another transcription", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-transcription-export-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const config = { dataDirectory: directory };
          const tools = createMediaTools(config);
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          const audio = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
          const media = yield* library.import(
            new Response(audio).body,
            "recording.wav",
            audio.length,
          );
          const transcript: Transcript = {
            language: "pl",
            segments: [
              { startMs: 125, endMs: 999, text: "Zażółć." },
              { startMs: 1000, endMs: 1800, text: "Second & <b>passage</b>." },
            ],
          };
          let attempts = 0;
          const transcriptions = createTranscriptions(database, config, tools, {
            check: () => Effect.void,
            transcribe: () =>
              Effect.sync(() => {
                attempts++;
                return transcript;
              }),
          });
          const app = createApp(database, config, undefined, { tools, transcriptions });
          const base = `http://127.0.0.1:4310/api/media/${media.id}/transcription`;
          yield* Effect.promise(async () => {
            expect((await app.request(`${base}/export/txt`)).status).toBe(400);
            expect((await app.request(`${base}/export/pdf`)).status).toBe(400);
            expect(
              (
                await app.request(
                  "http://127.0.0.1:4310/api/media/invalid/transcription/export/txt",
                )
              ).status,
            ).toBe(404);
          });
          yield* transcriptions.enqueue(media.id);
          yield* Effect.promise(async () => {
            expect((await app.request(`${base}/export/txt`)).status).toBe(400);
          });
          const worker = yield* transcriptions.start();
          yield* Effect.promise(async () => {
            await expect
              .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
              .toBe("completed");
            const exports = [
              {
                format: "txt",
                type: "text/plain; charset=utf-8",
                text: "Zażółć.\n\nSecond & <b>passage</b>.",
              },
              {
                format: "srt",
                type: "application/x-subrip; charset=utf-8",
                text: "1\n00:00:00,125 --> 00:00:00,999\nZażółć.\n\n2\n00:00:01,000 --> 00:00:01,800\nSecond &amp; &lt;b&gt;passage&lt;/b&gt;.\n\n",
              },
              {
                format: "vtt",
                type: "text/vtt; charset=utf-8",
                text: "WEBVTT\n\n1\n00:00:00.125 --> 00:00:00.999\nZażółć.\n\n2\n00:00:01.000 --> 00:00:01.800\nSecond &amp; &lt;b&gt;passage&lt;/b&gt;.\n\n",
              },
            ];
            for (const exported of exports) {
              const response = await app.request(`${base}/export/${exported.format}`);
              expect(response.status).toBe(200);
              expect(response.headers.get("content-type")).toBe(exported.type);
              expect(response.headers.get("content-disposition")).toBe(
                `attachment; filename="recording.${exported.format}"; filename*=UTF-8''recording.${exported.format}`,
              );
              expect(response.headers.get("cache-control")).toBe("private, no-store");
              expect(response.headers.get("x-content-type-options")).toBe("nosniff");
              expect(await response.text()).toBe(exported.text);
            }
            expect(
              (
                await app.request(`${base}/export/txt`, {
                  headers: { origin: "https://foreign.example" },
                })
              ).status,
            ).toBe(403);
            expect((await Effect.runPromise(transcriptions.get(media.id)))?.transcript).toEqual(
              transcript,
            );
            expect(attempts).toBe(1);
            const rename = await app.request(base.replace("/transcription", ""), {
              method: "PATCH",
              body: JSON.stringify({ title: "Renamed transcript" }),
            });
            expect(rename.status).toBe(200);
            expect(
              (await app.request(`${base}/export/txt`)).headers.get("content-disposition"),
            ).toContain('filename="Renamed transcript.txt"');
            expect(
              (await app.request(base.replace("/transcription", ""), { method: "DELETE" })).status,
            ).toBe(200);
            expect((await app.request(`${base}/export/txt`)).status).toBe(404);
          });
          yield* Fiber.interrupt(worker);
        }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
