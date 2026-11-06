import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { MediaToolsStatus, YtdlpStatus } from "../../../../src/shared/contracts/media-tools.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createYtdlp } from "../../../../src/server/media-tools/ytdlp.ts";
import { createApp } from "../../../../src/server/http/app.ts";

describe("media tools HTTP interface", () => {
  it("starts without tools or yt-dlp, serves uncached status and rejects unavailable installation without writing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-tools-http-"));
    const config = { dataDirectory: directory };
    const tools = createMediaTools(config, { build: null, environment: { PATH: "" } });
    const ytdlp = createYtdlp(config, { build: null, environment: { PATH: "" } });
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* openDatabase(":memory:");
            const app = createApp(database, config, undefined, { tools, ytdlp });
            yield* Effect.promise(async () => {
              const response = await app.request("http://localhost:4310/api/media-tools");
              expect(response.status).toBe(200);
              expect(response.headers.get("cache-control")).toBe("no-store");
              expect(
                Schema.decodeUnknownSync(MediaToolsStatus)(await response.json()),
              ).toMatchObject({
                ffprobe: { state: "missing" },
                ffmpeg: { state: "missing" },
                download: null,
                installation: { phase: "idle" },
              });
              const forbidden = await app.request("http://localhost:4310/api/media-tools/install", {
                method: "POST",
                headers: { origin: "https://foreign.example" },
              });
              expect(forbidden.status).toBe(403);
              const unavailable = await app.request(
                "http://localhost:4310/api/media-tools/install",
                { method: "POST" },
              );
              expect(unavailable.status).toBe(503);
              expect(await unavailable.json()).toEqual({
                error:
                  "Automatic media tools downloads are unavailable for this platform. Install FFmpeg and FFprobe manually and configure their paths.",
              });
              const upload = await app.request("http://localhost:4310/api/media", {
                method: "POST",
                headers: { "x-file-name": "tone.wav" },
                body: "unread data",
              });
              expect(upload.status).toBe(503);
              expect(await upload.json()).toEqual({
                error: "FFprobe is unavailable. Download media tools in Movo or set FFPROBE_PATH.",
              });
              const ytdlpResponse = await app.request("http://localhost:4310/api/ytdlp");
              expect(ytdlpResponse.headers.get("cache-control")).toBe("no-store");
              expect(
                Schema.decodeUnknownSync(YtdlpStatus)(await ytdlpResponse.json()),
              ).toMatchObject({
                ytdlp: { state: "missing" },
                download: null,
                installation: { phase: "idle" },
              });
              const foreignYtdlp = await app.request("http://localhost:4310/api/ytdlp/install", {
                method: "POST",
                headers: { origin: "https://foreign.example" },
              });
              expect(foreignYtdlp.status).toBe(403);
              const unavailableYtdlp = await app.request(
                "http://localhost:4310/api/ytdlp/install",
                { method: "POST" },
              );
              expect(unavailableYtdlp.status).toBe(503);
              expect(await unavailableYtdlp.json()).toEqual({
                error:
                  "Automatic yt-dlp downloads are unavailable for this platform. Install the official yt-dlp standalone executable and set YTDLP_PATH.",
              });
              expect(await readdir(directory)).toEqual([]);
              const library = await app.request("http://localhost:4310/api/media");
              expect(await library.json()).toEqual([]);
            });
          }),
        ),
      );
    } finally {
      await Effect.runPromise(ytdlp.close());
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });
});
