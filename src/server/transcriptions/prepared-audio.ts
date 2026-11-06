import { open } from "node:fs/promises";

const sampleBytes = Float32Array.BYTES_PER_ELEMENT;
const maxEngineSamples = 2 ** 31 - 1;
const readChunkBytes = 16 * 1024 * 1024;

export function assertPreparedAudioSize(bytes: number) {
  if (bytes === 0 || bytes % sampleBytes !== 0)
    throw new Error("Prepared audio is empty or incomplete.");
  if (bytes / sampleBytes > maxEngineSamples)
    throw new Error("The recording is longer than the transcription engine supports (37 hours).");
}

export async function readPreparedAudio(path: string) {
  const file = await open(path);
  try {
    const { size } = await file.stat();
    assertPreparedAudioSize(size);
    const pcm = Buffer.allocUnsafe(size);
    for (let offset = 0; offset < size;) {
      const { bytesRead } = await file.read(
        pcm,
        offset,
        Math.min(readChunkBytes, size - offset),
        offset,
      );
      if (bytesRead === 0) throw new Error("Prepared audio is empty or incomplete.");
      offset += bytesRead;
    }
    return pcm;
  } finally {
    await file.close();
  }
}
