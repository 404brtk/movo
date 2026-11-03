import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { HealthResponse } from "../../shared/contracts/health.ts";
import { openDatabase } from "../db/database.ts";
import { createApp } from "./app.ts";

describe("local HTTP interface", () => {
  it("serves a schema-valid health response using a real SQLite connection", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(":memory:");
          const response = yield* Effect.promise(async () =>
            createApp(database).request("http://127.0.0.1:4310/api/health"),
          );
          expect(response.status).toBe(200);
          const payload = yield* Effect.promise(() => response.json());
          expect(Schema.decodeUnknownSync(HealthResponse)(payload)).toEqual({ status: "ok" });
        }),
      ),
    );
  });

  it.each([
    { url: "http://untrusted.example/api/health", origin: undefined, status: 403 },
    { url: "http://127.0.0.1:4310/api/health", origin: "https://untrusted.example", status: 403 },
    { url: "http://127.0.0.1:4310/api/health", origin: "null", status: 403 },
    { url: "http://127.0.0.1:4310/api/health", origin: "http://127.0.0.1:5173", status: 200 },
    { url: "http://127.0.0.1:4310/api/missing", origin: undefined, status: 404 },
  ])("handles $url with origin $origin", async ({ url, origin, status }) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(":memory:");
          const response = yield* Effect.promise(async () =>
            createApp(database).request(url, origin ? { headers: { origin } } : undefined),
          );
          expect(response.status).toBe(status);
        }),
      ),
    );
  });
});
