import { availableParallelism } from "node:os";
import { Schema } from "effect";
import { maxSpeakers } from "../../shared/contracts/transcriptions.ts";
import { SpeakerSegments } from "./speakers.ts";

const detectSpeakerCount = -1;
const speakerDistanceThreshold = 0.5;

export async function diarizeSpeakers(
  segmentationPath: string,
  embeddingPath: string,
  pcm: Uint8Array,
) {
  const { default: sherpaOnnx } = await import("sherpa-onnx-node");
  const numThreads = availableParallelism();
  const diarization = new sherpaOnnx.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationPath }, numThreads },
    embedding: { model: embeddingPath, numThreads },
    clustering: { numClusters: detectSpeakerCount, threshold: speakerDistanceThreshold },
  });
  if (diarization.sampleRate !== 16000)
    throw new Error("The speaker models do not support 16 kHz audio.");
  const samples = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const readSegments = Schema.decodeUnknownSync(SpeakerSegments);
  const segments = readSegments(diarization.process(samples));
  if (new Set(segments.map(({ speaker }) => speaker)).size <= maxSpeakers) return segments;
  diarization.setConfig({
    clustering: { numClusters: maxSpeakers, threshold: speakerDistanceThreshold },
  });
  return readSegments(diarization.process(samples));
}
