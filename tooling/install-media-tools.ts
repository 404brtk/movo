import { dirname, isAbsolute } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Effect } from "effect";
import { createMediaTools } from "../src/server/media-tools/tools.ts";
import { activeInstallationPhases } from "../src/shared/contracts/media-tools.ts";

const [dataDirectory] = process.argv.slice(2);
if (!dataDirectory || !isAbsolute(dataDirectory)) {
  throw new Error("Usage: node tooling/install-media-tools.ts <absolute data directory>");
}

const tools = createMediaTools({ dataDirectory }, { environment: { PATH: "" } });
try {
  let status = await Effect.runPromise(tools.install());
  while (activeInstallationPhases.includes(status.installation.phase)) {
    await setTimeout(500);
    status = await Effect.runPromise(tools.status());
  }
  if (status.installation.error) {
    throw new Error(status.installation.error);
  }
  console.log(dirname(await Effect.runPromise(tools.resolve("ffmpeg"))));
} finally {
  await Effect.runPromise(tools.close());
}
