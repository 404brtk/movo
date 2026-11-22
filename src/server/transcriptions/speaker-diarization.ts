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
  reportProgress: (fraction: number) => void,
) {
  const { default: sherpaOnnx } = await import("sherpa-onnx-node/addon.js");
  const numThreads = availableParallelism();
  const diarization = sherpaOnnx.createOfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationPath }, numThreads },
    embedding: { model: embeddingPath, numThreads },
    clustering: { numClusters: detectSpeakerCount, threshold: speakerDistanceThreshold },
  });
  if (sherpaOnnx.getOfflineSpeakerDiarizationSampleRate(diarization) !== 16000)
    throw new Error("The speaker models do not support 16 kHz audio.");
  const samples = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const diarize = async () =>
    Schema.decodeUnknownSync(SpeakerSegments)(
      await sherpaOnnx.offlineSpeakerDiarizationProcessAsync(diarization, samples, (done, total) =>
        reportProgress(done / total),
      ),
    );
  const segments = await diarize();
  if (new Set(segments.map(({ speaker }) => speaker)).size <= maxSpeakers) return segments;
  sherpaOnnx.offlineSpeakerDiarizationSetConfig(diarization, {
    clustering: { numClusters: maxSpeakers, threshold: speakerDistanceThreshold },
  });
  return diarize();
}
