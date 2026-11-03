import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { activeInstallationPhases } from "../../src/shared/contracts/media-tools.ts";
import { openDatabase } from "../../src/server/db/database.ts";
import { createMediaLibrary } from "../../src/server/media/library.ts";
import { probeMedia } from "../../src/server/media/probe.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";

const execute = promisify(execFile);

it("downloads the pinned tools, imports audio and converts it using only the managed executables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-real-tools-"));
  const tools = createMediaTools({ dataDirectory: directory }, { environment: { PATH: "" } });
  try {
    const initial = await Effect.runPromise(tools.status());
    expect(initial.download).not.toBeNull();
    expect(initial.ffprobe.state).toBe("missing");
    await Effect.runPromise(tools.install());
    await expect
      .poll(
        async () => {
          const status = await Effect.runPromise(tools.status());
          if (status.installation.phase === "failed")
            throw new Error(status.installation.error ?? "Installation failed");
          return activeInstallationPhases.includes(status.installation.phase);
        },
        { timeout: 9 * 60 * 1000, interval: 500 },
      )
      .toBe(false);
    const installed = await Effect.runPromise(tools.status());
    expect(installed.ffprobe).toMatchObject({ state: "ready", source: "managed" });
    expect(installed.ffmpeg).toMatchObject({ state: "ready", source: "managed" });
    const wave = await readFile(new URL("../fixtures/tone.wav", import.meta.url));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, "app.sqlite"));
          const library = createMediaLibrary(database, directory, () => tools.resolve("ffprobe"));
          const imported = yield* library.import(
            new Response(new Uint8Array(wave)).body,
            "tone.wav",
          );
          expect(imported.durationSeconds).toBe(2);
          const saved = yield* library.file(imported.id);
          expect(yield* Effect.promise(() => readFile(saved.path))).toEqual(wave);
          const ffmpeg = yield* tools.resolve("ffmpeg");
          const converted = join(directory, "converted.wav");
          yield* Effect.promise(() =>
            execute(
              ffmpeg,
              ["-v", "error", "-i", saved.path, "-ac", "1", "-ar", "16000", converted],
              { timeout: 30000, windowsHide: true },
            ),
          );
          const ffprobe = yield* tools.resolve("ffprobe");
          expect(yield* probeMedia(converted, "converted.wav", ffprobe)).toMatchObject({
            durationSeconds: 2,
            kind: "audio",
          });
        }),
      ),
    );
    const reopened = createMediaTools({ dataDirectory: directory }, { environment: { PATH: "" } });
    try {
      expect((await Effect.runPromise(reopened.status())).ffprobe).toMatchObject({
        state: "ready",
        source: "managed",
      });
    } finally {
      await Effect.runPromise(reopened.close());
    }
  } finally {
    await Effect.runPromise(tools.close());
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
