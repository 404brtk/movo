import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Schema } from "effect";
import { expect, it } from "vitest";
import { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { openDatabase } from "../db/database.ts";
import { createMediaLibrary } from "../media/library.ts";
import { createMediaTools } from "../media-tools/tools.ts";
import { createTranscriptions } from "../transcriptions/jobs.ts";
import { createApp } from "./app.ts";

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
          const audio = readFileSync(new URL("../../../tests/fixtures/tone.wav", import.meta.url));
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
            await expect
              .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
              .toBe("running");
            expect((await app.request(`${base}/retry`, { method: "POST" })).status).toBe(400);
            expect((await app.request(`${base}/cancel`, { method: "POST" })).status).toBe(200);
            expect((await Effect.runPromise(transcriptions.get(media.id)))?.status).toBe(
              "cancelled",
            );
            complete = true;
            expect((await app.request(`${base}/retry`, { method: "POST" })).status).toBe(202);
            await expect
              .poll(async () => (await Effect.runPromise(transcriptions.get(media.id)))?.status)
              .toBe("completed");
            expect(
              Schema.decodeUnknownSync(TranscriptionJob)(await (await app.request(base)).json())
                .transcript,
            ).toEqual({ language: null, segments: [] });
          });
          yield* Fiber.interrupt(worker);
        }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
