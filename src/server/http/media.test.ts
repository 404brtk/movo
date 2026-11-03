import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { maxImportBytes, MediaItem, MediaList } from "../../shared/contracts/media.ts";
import { openDatabase } from "../db/database.ts";
import { createApp } from "./app.ts";

const wave = readFileSync(new URL("../../../tests/fixtures/tone.wav", import.meta.url));
const video = readFileSync(new URL("../../../tests/fixtures/sample.webm", import.meta.url));
const base = "http://127.0.0.1:4310/api/media";

async function withApp(run: (app: ReturnType<typeof createApp>) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "movo-media-http-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const app = createApp(database, {
            dataDirectory: directory,
            ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
          });
          yield* Effect.promise(() => run(app));
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function importWave(app: ReturnType<typeof createApp>) {
  const response = await app.request(base, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent("Próbka nagrania.wav") },
    body: new Uint8Array(wave),
  });
  expect(response.status).toBe(201);
  return Schema.decodeUnknownSync(MediaItem)(await response.json());
}

describe("media HTTP interface", () => {
  it("imports audio using its real format and lists saved metadata", async () => {
    await withApp(async (app) => {
      const imported = await importWave(app);
      expect(imported).toMatchObject({
        title: "Próbka nagrania",
        kind: "audio",
        durationSeconds: 2,
        byteSize: wave.length,
      });
      const list = await app.request(base);
      expect(Schema.decodeUnknownSync(MediaList)(await list.json())).toEqual([imported]);
      const detail = await app.request(`${base}/${imported.id}`);
      expect(await detail.json()).toEqual(imported);
    });
  });

  it("identifies video regardless of the claimed HTTP content type", async () => {
    await withApp(async (app) => {
      const response = await app.request(base, {
        method: "POST",
        headers: { "x-file-name": "sample.webm", "content-type": "text/html" },
        body: new Uint8Array(video),
      });
      expect(response.status).toBe(201);
      const imported = Schema.decodeUnknownSync(MediaItem)(await response.json());
      expect(imported).toMatchObject({
        kind: "video",
        contentType: "video/webm",
        byteSize: video.length,
      });
      expect(imported.durationSeconds).toBeGreaterThanOrEqual(2);
    });
  });

  it("serves the saved bytes and supports HEAD, bounded and suffix ranges", async () => {
    await withApp(async (app) => {
      const imported = await importWave(app);
      const url = `${base}/${imported.id}/file`;
      const head = await app.request(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(wave.length));
      expect(head.headers.get("accept-ranges")).toBe("bytes");
      expect(await head.text()).toBe("");
      const full = await app.request(url);
      expect(full.headers.get("content-type")).toBe("audio/wav");
      expect(full.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await full.arrayBuffer())).toEqual(wave);
      const range = await app.request(url, { headers: { range: "bytes=10-29" } });
      expect(range.status).toBe(206);
      expect(range.headers.get("content-range")).toBe(`bytes 10-29/${wave.length}`);
      expect(range.headers.get("content-length")).toBe("20");
      expect(Buffer.from(await range.arrayBuffer())).toEqual(wave.subarray(10, 30));
      const suffix = await app.request(url, { headers: { range: "bytes=-16" } });
      expect(suffix.status).toBe(206);
      expect(Buffer.from(await suffix.arrayBuffer())).toEqual(wave.subarray(-16));
      const unsatisfiable = await app.request(url, { headers: { range: `bytes=${wave.length}-` } });
      expect(unsatisfiable.status).toBe(416);
      expect(unsatisfiable.headers.get("content-range")).toBe(`bytes */${wave.length}`);
      expect(await unsatisfiable.text()).toBe("");
    });
  });

  it.each(["not-an-id", "00000000-0000-4000-8000-000000000000"])(
    "returns JSON 404 for missing media %s",
    async (id) => {
      await withApp(async (app) => {
        for (const url of [`${base}/${id}`, `${base}/${id}/file`]) {
          const response = await app.request(url);
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ error: "Media not found." });
        }
      });
    },
  );

  it.each([
    { name: "../outside.wav", size: undefined, status: 400 },
    { name: "%invalid", size: undefined, status: 400 },
    { name: "recording.wav", size: "0", status: 400 },
    { name: "recording.wav", size: String(maxImportBytes + 1), status: 413 },
  ])("rejects import name $name and size $size", async ({ name, size, status }) => {
    await withApp(async (app) => {
      const headers: Record<string, string> = { "x-file-name": name };
      if (size !== undefined) headers["content-length"] = size;
      const response = await app.request(base, {
        method: "POST",
        headers,
        body: new Uint8Array(wave),
      });
      expect(response.status).toBe(status);
      expect(await (await app.request(base)).json()).toEqual([]);
    });
  });

  it("rejects unsupported data and cross-origin writes", async () => {
    await withApp(async (app) => {
      const unsupported = await app.request(base, {
        method: "POST",
        headers: { "x-file-name": "fake.wav" },
        body: "not media",
      });
      expect(unsupported.status).toBe(415);
      const forbidden = await app.request(base, {
        method: "POST",
        headers: { "x-file-name": "recording.wav", origin: "https://untrusted.example" },
        body: new Uint8Array(wave),
      });
      expect(forbidden.status).toBe(403);
      expect(await (await app.request(base)).json()).toEqual([]);
    });
  });
});
