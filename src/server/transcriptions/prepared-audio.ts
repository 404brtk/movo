import { open } from "node:fs/promises";

const sampleBytes = Float32Array.BYTES_PER_ELEMENT;
const maxEngineSamples = 2 ** 31 - 1;
const readChunkBytes = 16 * 1024 * 1024;

export async function readPreparedAudio(path: string) {
  const file = await open(path);
  try {
    const { size } = await file.stat();
    if (size === 0 || size % sampleBytes !== 0)
      throw new Error("Prepared audio is empty or incomplete.");
    if (size / sampleBytes > maxEngineSamples)
      throw new Error("The recording is longer than the transcription engine supports (37 hours).");
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
