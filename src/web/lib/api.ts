import { Schema } from "effect";
import { hc } from "hono/client";
import type { AppType } from "../../server/http/app.ts";
import { HealthResponse } from "../../shared/contracts/health.ts";

const client = hc<AppType>("/");

export async function getHealth(signal: AbortSignal) {
  const response = await client.api.health.$get({}, { init: { signal } });
  if (!response.ok) {
    throw new Error(`Local service returned HTTP ${response.status}`);
  }
  return Schema.decodeUnknownSync(HealthResponse)(await response.json());
}
