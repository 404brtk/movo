import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import {
  assertPreparedAudioSize,
  readPreparedAudio,
} from "../../../../src/server/transcriptions/prepared-audio.ts";

const sampleBytes = Float32Array.BYTES_PER_ELEMENT;
const maxEngineSamples = 2 ** 31 - 1;

async function preparedAudioPath() {
  const directory = await mkdtemp(join(tmpdir(), "movo-prepared-audio-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "audio.f32");
}

it("reads prepared audio larger than one read chunk without changing its samples", async () => {
  const samples = Float32Array.from({ length: 4 * 1024 * 1024 + 3 }, (_, index) => index % 9973);
  const bytes = new Uint8Array(samples.buffer);
  const path = await preparedAudioPath();
  await writeFile(path, bytes);
  const pcm = await readPreparedAudio(path);
  expect(pcm.equals(bytes)).toBe(true);
});

it("rejects empty and partial-sample prepared audio before reading it", async () => {
  const path = await preparedAudioPath();
  await writeFile(path, new Uint8Array(6));
  await expect(readPreparedAudio(path)).rejects.toThrow("Prepared audio is empty or incomplete.");
  expect(() => assertPreparedAudioSize(0)).toThrow("Prepared audio is empty or incomplete.");
});

it("accepts prepared audio up to the engine's sample limit and rejects longer audio", () => {
  expect(() => assertPreparedAudioSize(maxEngineSamples * sampleBytes)).not.toThrow();
  expect(() => assertPreparedAudioSize((maxEngineSamples + 1) * sampleBytes)).toThrow(
    "The recording is longer than the transcription engine supports (37 hours).",
  );
});
