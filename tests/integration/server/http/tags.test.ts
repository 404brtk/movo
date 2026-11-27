import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { LibraryList } from "../../../../src/shared/contracts/library.ts";
import { MediaItem } from "../../../../src/shared/contracts/media.ts";
import { Tag, TagList, tagColors } from "../../../../src/shared/contracts/tags.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createApp } from "../../../../src/server/http/app.ts";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";

const wave = readFileSync(new URL("../../../fixtures/tone.wav", import.meta.url));
const api = "http://127.0.0.1:4310/api";
type App = ReturnType<typeof createApp>;

async function withApp(run: (app: App, directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "movo-tags-http-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const config = {
            dataDirectory: directory,
            ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
          };
          const app = createApp(database, config, undefined, {
            tools: createMediaTools(config),
          });
          yield* Effect.promise(() => run(app, directory));
        }),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const send = (app: App, method: string, path: string, body?: unknown) =>
  app.request(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

async function createTag(app: App, name: string, color?: string) {
  const response = await send(app, "POST", "/tags", color ? { name, color } : { name });
  expect(response.status).toBe(201);
  return Schema.decodeUnknownSync(Tag)(await response.json());
}

async function importWave(app: App, name: string, tags?: readonly string[]) {
  const response = await app.request(`${api}/media${tags ? `?tags=${tags.join(",")}` : ""}`, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent(name) },
    body: new Uint8Array(wave),
  });
  expect(response.status).toBe(201);
  return Schema.decodeUnknownSync(MediaItem)(await response.json());
}

const listTags = async (app: App) =>
  Schema.decodeUnknownSync(TagList)(await (await send(app, "GET", "/tags")).json());

const browse = async (app: App, query: string) =>
  Schema.decodeUnknownSync(LibraryList)(await (await send(app, "GET", `/media?${query}`)).json())
    .items;

describe("tags HTTP interface", () => {
  it("creates, renames, recolours and lists tags with unique names ignoring letter case", async () => {
    await withApp(async (app) => {
      const first = await createTag(app, "Łódź");
      expect(first).toMatchObject({ name: "Łódź", color: "gray", recordingCount: 0 });
      expect((await createTag(app, "Archiwum")).color).toBe("amber");
      for (const name of ["łÓDŹ", "ŁÓDŹ"]) {
        const duplicate = await send(app, "POST", "/tags", { name });
        expect(duplicate.status).toBe(409);
        expect(await duplicate.json()).toEqual({
          error: `“${name}” already exists. Choose another name.`,
        });
      }
      for (const body of [
        {},
        { name: "" },
        { name: " padded " },
        { name: "two\nlines" },
        { name: "a".repeat(65) },
        { name: "Valid", color: "red" },
      ]) {
        const rejected = await send(app, "POST", "/tags", body);
        expect(rejected.status).toBe(400);
      }
      const renamed = await send(app, "PATCH", `/tags/${first.id}`, {
        name: "Lodz",
        color: "pink",
      });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ id: first.id, name: "Lodz", color: "pink" });
      const sameName = await send(app, "PATCH", `/tags/${first.id}`, { name: "LODZ" });
      expect(sameName.status).toBe(200);
      const taken = await send(app, "PATCH", `/tags/${first.id}`, { name: "archiwum" });
      expect(taken.status).toBe(409);
      expect((await send(app, "PATCH", `/tags/${first.id}`, {})).status).toBe(400);
      expect(
        (await send(app, "PATCH", "/tags/00000000-0000-4000-8000-000000000000", { name: "X" }))
          .status,
      ).toBe(404);
      expect((await send(app, "DELETE", "/tags/not-a-tag")).status).toBe(404);
      expect((await listTags(app)).map((tag) => tag.name)).toEqual(["Archiwum", "LODZ"]);
    });
  });

  it("rejects a 501st tag while preserving existing names", async () => {
    await withApp(async (app) => {
      for (let i = 0; i < 500; i++) await createTag(app, `Tag ${i}`);
      expect((await send(app, "POST", "/tags", { name: "One more" })).status).toBe(409);
      expect(await listTags(app)).toHaveLength(500);
    });
  });

  it("gives a new tag the colour used by the fewest tags", async () => {
    await withApp(async (app) => {
      for (const color of tagColors.slice(0, 3)) await createTag(app, `Tag ${color}`, color);
      await createTag(app, "Second gray", "gray");
      expect((await createTag(app, "Next")).color).toBe("teal");
    });
  });

  it("tags recordings, filters the library by every chosen tag and limits each recording to 20 tags", async () => {
    await withApp(async (app) => {
      const client = await createTag(app, "Klient");
      const meeting = await createTag(app, "Spotkania");
      const first = await importWave(app, "First.wav");
      const second = await importWave(app, "Second.wav");
      const set = await send(app, "PUT", `/media/${first.id}/tags`, {
        tagIds: [meeting.id, client.id],
      });
      expect(set.status).toBe(200);
      expect((await set.json()).tags.map((tag: { name: string }) => tag.name)).toEqual([
        "Klient",
        "Spotkania",
      ]);
      const bulk = await send(app, "POST", "/media/tags", {
        mediaIds: [first.id, second.id],
        add: [client.id],
        remove: [],
      });
      expect(bulk.status).toBe(200);
      expect((await browse(app, `tags=${client.id}`)).map((item) => item.title).toSorted()).toEqual(
        ["First", "Second"],
      );
      expect((await browse(app, `tags=${client.id},${meeting.id}`)).map((item) => item.id)).toEqual(
        [first.id],
      );
      expect(await browse(app, `tags=${client.id},${meeting.id}&kind=video`)).toEqual([]);
      expect(await browse(app, `tags=${client.id}&q=second`)).toHaveLength(1);
      expect((await listTags(app)).map((tag) => tag.recordingCount)).toEqual([2, 1]);
      for (const query of ["tags=", "tags=nope", `tags=${client.id},${client.id}`])
        expect((await send(app, "GET", `/media?${query}`)).status).toBe(400);

      const many = await Promise.all(
        Array.from({ length: 19 }, (_, index) => createTag(app, `Extra ${index}`)),
      );
      expect(
        (
          await send(app, "PUT", `/media/${second.id}/tags`, {
            tagIds: [client.id, ...many.map((tag) => tag.id)],
          })
        ).status,
      ).toBe(200);
      expect(
        (await send(app, "PUT", `/media/${first.id}/tags`, { tagIds: [client.id] })).status,
      ).toBe(200);
      const overLimit = await send(app, "POST", "/media/tags", {
        mediaIds: [first.id, second.id],
        add: [meeting.id],
        remove: [],
      });
      expect(overLimit.status).toBe(409);
      expect(await overLimit.json()).toEqual({
        error: "“Second” would have more than 20 tags. Remove some of its tags first.",
      });
      expect(await browse(app, `tags=${meeting.id}`)).toEqual([]);
      expect(
        (
          await send(app, "PUT", `/media/${first.id}/tags`, {
            tagIds: [client.id, meeting.id, ...many.map((tag) => tag.id)],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await send(app, "PUT", `/media/${first.id}/tags`, {
            tagIds: ["00000000-0000-4000-8000-000000000000"],
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await send(app, "POST", "/media/tags", {
            mediaIds: [first.id],
            add: [client.id],
            remove: [client.id],
          })
        ).status,
      ).toBe(400);
    });
  });

  it("removes a deleted tag from recordings, and a deleted recording from tags", async () => {
    await withApp(async (app) => {
      const kept = await createTag(app, "Kept");
      const removed = await createTag(app, "Removed");
      const item = await importWave(app, "Tagged.wav", [kept.id, removed.id]);
      expect(item.tags.map((tag) => tag.name)).toEqual(["Kept", "Removed"]);
      const deleted = await send(app, "DELETE", `/tags/${removed.id}`);
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toMatchObject({ name: "Removed", recordingCount: 1 });
      expect((await (await send(app, "GET", `/media/${item.id}`)).json()).tags).toEqual([
        { id: kept.id, name: "Kept", color: kept.color },
      ]);
      expect((await send(app, "DELETE", `/media/${item.id}`)).status).toBe(200);
      expect((await listTags(app)).map((tag) => tag.recordingCount)).toEqual([0]);
    });
  });

  it("rejects an import with an unknown tag before storing the recording", async () => {
    await withApp(async (app, directory) => {
      const response = await app.request(`${api}/media?tags=00000000-0000-4000-8000-000000000000`, {
        method: "POST",
        headers: { "x-file-name": "Missing.wav" },
        body: new Uint8Array(wave),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "This tag no longer exists." });
      expect(await browse(app, "")).toEqual([]);
      expect(readdirSync(directory)).not.toContain("media");
      expect(
        (
          await app.request(`${api}/media?tags=bad`, {
            method: "POST",
            headers: { "x-file-name": "Bad.wav" },
            body: new Uint8Array(wave),
          })
        ).status,
      ).toBe(400);
    });
  });
});
