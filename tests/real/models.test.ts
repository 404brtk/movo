import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { activeModelPhases } from "../../src/shared/contracts/models.ts";
import { transcriptionModel } from "../../src/server/models/catalog.ts";
import { createModels } from "../../src/server/models/models.ts";
import { modelCachePath } from "../../src/server/models/cache.ts";
import { validateModel } from "../../src/server/models/validation.ts";

it("installs the pinned real model, loads it in an isolated CPU worker and discovers it after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-real-model-"));
  const models = createModels({ cacheDirectory: directory });
  try {
    expect((await Effect.runPromise(models.list()))[0]?.state).toBe("missing");
    await Effect.runPromise(models.install(transcriptionModel.id));
    await expect
      .poll(
        async () =>
          activeModelPhases.includes(
            (await Effect.runPromise(models.list()))[0]?.installation.phase ?? "",
          ),
        { timeout: 9 * 60 * 1000, interval: 500 },
      )
      .toBe(false);
    const installed = (await Effect.runPromise(models.list()))[0];
    if (installed?.installation.error) throw new Error(installed.installation.error);
    expect(installed?.state).toBe("ready");
    await validateModel(modelCachePath(directory, transcriptionModel), AbortSignal.timeout(120000));
    expect(installed?.installation.downloadedBytes).toBe(transcriptionModel.bytes);
    await Effect.runPromise(models.close());
    const reopened = createModels({ cacheDirectory: directory });
    try {
      expect((await Effect.runPromise(reopened.list()))[0]?.state).toBe("ready");
    } finally {
      await Effect.runPromise(reopened.close());
    }
    expect(
      await readdir(
        join(
          directory,
          `models--${transcriptionModel.repository.replaceAll("/", "--")}`,
          "snapshots",
          transcriptionModel.revision,
        ),
      ),
    ).toEqual([transcriptionModel.filename]);
  } finally {
    await Effect.runPromise(models.close());
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
