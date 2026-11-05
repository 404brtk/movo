import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Schema } from "effect";
import { expect, it } from "vitest";
import { DownloadJob, DownloadJobList } from "../../../../src/shared/contracts/downloads.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createDownloads } from "../../../../src/server/downloads/jobs.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { createApp } from "../../../../src/server/http/app.ts";

const base = "http://127.0.0.1:4310/api/downloads";
const url = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

it("validates HTTP input, queues independently of its request and exposes cancellation and retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-download-http-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const config = { dataDirectory: directory };
          const tools = createMediaTools(config);
          const downloads = createDownloads(database, config, tools, {
            preview: (value) =>
              Effect.succeed({ url: value, title: "A public recording", durationSeconds: null }),
            download: () => Effect.never,
          });
          const app = createApp(database, config, undefined, { tools, downloads });
          const worker = yield* downloads.start();
          yield* Effect.promise(async () => {
            expect((await app.request(`${base}/preview`, json({ url }))).status).toBe(200);
            expect((await app.request(base, json({}))).status).toBe(400);
            expect((await app.request(base, { method: "POST", body: "{" })).status).toBe(400);
            expect(
              (await app.request(base, json({ url: "https://example.com/video" }))).status,
            ).toBe(400);
            expect((await app.request(base, json({ url: "x".repeat(5000) }))).status).toBe(413);
            expect(
              (
                await app.request(base, {
                  ...json({ url }),
                  headers: { origin: "https://foreign.example" },
                })
              ).status,
            ).toBe(403);
            const response = await app.request(base, json({ url }));
            expect(response.status).toBe(202);
            const job = Schema.decodeUnknownSync(DownloadJob)(await response.json());
            expect(job.preset).toBe("video-1080p");
            await expect
              .poll(async () => (await Effect.runPromise(downloads.get(job.id))).status)
              .toBe("running");
            const list = await app.request(base);
            expect(list.headers.get("cache-control")).toBe("no-store");
            expect(
              Schema.decodeUnknownSync(DownloadJobList)(await list.json()).map((item) => item.id),
            ).toEqual([job.id]);
            expect((await app.request(base, json({ url, preset: "video-2160p" }))).status).toBe(
              400,
            );
            expect((await app.request(base, json({ url, preset: 720 }))).status).toBe(400);
            const audio = Schema.decodeUnknownSync(DownloadJob)(
              await (await app.request(base, json({ url, preset: "audio" }))).json(),
            );
            const smaller = Schema.decodeUnknownSync(DownloadJob)(
              await (await app.request(base, json({ url, preset: "video-720p" }))).json(),
            );
            expect(audio).toMatchObject({ preset: "audio" });
            expect(smaller).toMatchObject({ preset: "video-720p" });
            expect(new Set([job.id, audio.id, smaller.id]).size).toBe(3);
            expect((await app.request(`${base}/${job.id}/cancel`, { method: "POST" })).status).toBe(
              200,
            );
            expect((await Effect.runPromise(downloads.get(job.id))).status).toBe("cancelled");
            expect((await app.request(`${base}/${job.id}/retry`, { method: "POST" })).status).toBe(
              202,
            );
            expect((await app.request(`${base}/invalid-id`)).status).toBe(404);
          });
          yield* Fiber.interrupt(worker);
        }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
