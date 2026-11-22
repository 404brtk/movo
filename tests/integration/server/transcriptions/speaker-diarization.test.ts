import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { diarizeSpeakers } from "../../../../src/server/transcriptions/speaker-diarization.ts";

it("loads the native speaker runtime without weights and rejects missing models", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-speaker-runtime-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await expect(
    diarizeSpeakers(
      join(directory, "segmentation.onnx"),
      join(directory, "embedding.onnx"),
      Buffer.alloc(16000 * Float32Array.BYTES_PER_ELEMENT),
      () => {},
    ),
  ).rejects.toThrow(/check your config/u);
});
