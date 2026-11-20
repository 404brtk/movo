import { availableParallelism } from "node:os";

const detectSpeakerCount = -1;
const speakerDistanceThreshold = 0.5;

export async function diarizeSpeakers(
  segmentationPath: string,
  embeddingPath: string,
  pcm: Buffer,
): Promise<unknown> {
  const { default: sherpaOnnx } = await import("sherpa-onnx-node");
  const numThreads = availableParallelism();
  const diarization = new sherpaOnnx.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationPath }, numThreads },
    embedding: { model: embeddingPath, numThreads },
    clustering: { numClusters: detectSpeakerCount, threshold: speakerDistanceThreshold },
  });
  if (diarization.sampleRate !== 16000)
    throw new Error("The speaker models do not support 16 kHz audio.");
  return diarization.process(
    new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / Float32Array.BYTES_PER_ELEMENT),
  );
}
