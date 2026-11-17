import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import {
  DictionaryList,
  DictionaryPreview,
  DictionarySaveResult,
} from "../../../../src/shared/contracts/dictionary.ts";
import { openDatabase } from "../../../../src/server/db/database.ts";
import { createApp } from "../../../../src/server/http/app.ts";

const base = "http://127.0.0.1:4310/api/dictionary";
const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});
const draft = {
  spelling: "Parakeet",
  similar: true,
  alsoReplace: ["para keet"],
  neverChange: ["parakeets"],
};

it("stores, previews, updates and removes dictionary entries over HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-dictionary-http-"));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const app = createApp(database, { dataDirectory: directory });
          yield* Effect.promise(async () => {
            const empty = await app.request(base);
            expect(empty.headers.get("cache-control")).toBe("no-store");
            expect(await empty.json()).toEqual([]);

            const created = await app.request(base, json("POST", { draft, fix: [] }));
            expect(created.status).toBe(201);
            const { entry } = Schema.decodeUnknownSync(DictionarySaveResult)(await created.json());
            expect(entry).toMatchObject({ ...draft, fixes: 0 });

            const preview = await app.request(
              `${base}/preview`,
              json("POST", { id: entry.id, draft }),
            );
            expect(Schema.decodeUnknownSync(DictionaryPreview)(await preview.json())).toEqual({
              hitCount: 0,
              recordings: [],
            });

            const clash = await app.request(
              base,
              json("POST", { draft: { ...draft, spelling: "parakeet" }, fix: [] }),
            );
            expect(clash.status).toBe(400);
            expect(await clash.json()).toEqual({
              error: "“Parakeet” is already in the dictionary.",
            });

            for (const invalid of [
              { draft: { ...draft, spelling: " Parakeet" }, fix: [] },
              { draft: { ...draft, alsoReplace: ["a\nb"] }, fix: [] },
              { draft: { ...draft, neverChange: Array.from({ length: 51 }, (_, at) => `w${at}`) } },
              { draft, fix: [{ mediaId: "not-an-id", revision: 0, skip: [] }] },
            ]) {
              const rejected = await app.request(base, json("POST", invalid));
              expect(rejected.status).toBe(400);
            }

            const updated = await app.request(
              `${base}/${entry.id}`,
              json("PUT", { draft: { ...draft, alsoReplace: [] }, fix: [] }),
            );
            expect(updated.status).toBe(200);
            expect(
              Schema.decodeUnknownSync(DictionarySaveResult)(await updated.json()).entry
                .alsoReplace,
            ).toEqual([]);

            expect((await app.request(`${base}/not-an-id`, { method: "DELETE" })).status).toBe(404);
            const removed = await app.request(`${base}/${entry.id}`, { method: "DELETE" });
            expect(Schema.decodeUnknownSync(DictionaryList)(await removed.json())).toEqual([]);
            expect((await app.request(`${base}/${entry.id}`, { method: "DELETE" })).status).toBe(
              404,
            );

            const oversized = await app.request(
              base,
              json("POST", { draft, fix: [], padding: "x".repeat(300 * 1024) }),
            );
            expect(oversized.status).toBe(413);
          });
        }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
