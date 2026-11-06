import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { readPreparedAudio } from "../../../../src/server/transcriptions/prepared-audio.ts";

async function preparedAudioFile(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "movo-prepared-audio-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "audio.f32");
  await writeFile(path, bytes);
  return path;
}

it("reads prepared audio larger than one read chunk without changing its samples", async () => {
  const samples = Float32Array.from({ length: 4 * 1024 * 1024 + 3 }, (_, index) => index % 9973);
  const bytes = new Uint8Array(samples.buffer);
  const pcm = await readPreparedAudio(await preparedAudioFile(bytes));
  expect(pcm.equals(bytes)).toBe(true);
});

it.for([
  ["empty", new Uint8Array()],
  ["partial-sample", new Uint8Array(6)],
] as const)("rejects %s prepared audio", async ([, bytes]) => {
  await expect(readPreparedAudio(await preparedAudioFile(bytes))).rejects.toThrow(
    "Prepared audio is empty or incomplete.",
  );
});
