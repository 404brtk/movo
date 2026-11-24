import { availableParallelism } from "node:os";
import { Schema } from "effect";
import { maxSpeakers, type TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";
import { modelDevice, processorDevice } from "./device.ts";
import { SpeakerTurns } from "./speakers.ts";

export const SpeakerDiarizer = Schema.Union([
  Schema.Struct({ model: Schema.Literal("sortformer-4spk-q8"), diarization: Schema.String }),
  Schema.Struct({
    model: Schema.Literal("pyannote-wespeaker"),
    segmentation: Schema.String,
    embedding: Schema.String,
  }),
]);
export type SpeakerDiarizer = typeof SpeakerDiarizer.Type;

const PyannoteSegments = Schema.Array(
  Schema.Struct({ start: Schema.Number, end: Schema.Number, speaker: Schema.Number }),
);
const SortformerSegments = Schema.Array(
  Schema.Struct({ t0Ms: Schema.Number, t1Ms: Schema.Number, speakerId: Schema.Number }),
);
const detectSpeakerCount = -1;

export interface DiarizationReport {
  device: (device: TranscriptionDevice) => void;
  progress: (fraction: number) => void;
}
const speakerDistanceThreshold = 0.5;

async function diarizeWithPyannote(
  segmentationPath: string,
  embeddingPath: string,
  samples: Float32Array,
  report: DiarizationReport,
) {
  const { default: sherpaOnnx } = await import("sherpa-onnx-node/addon.js");
  report.device(processorDevice());
  const numThreads = availableParallelism();
  const diarization = sherpaOnnx.createOfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationPath }, numThreads },
    embedding: { model: embeddingPath, numThreads },
    clustering: { numClusters: detectSpeakerCount, threshold: speakerDistanceThreshold },
  });
  if (sherpaOnnx.getOfflineSpeakerDiarizationSampleRate(diarization) !== 16000)
    throw new Error("The speaker models do not support 16 kHz audio.");
  const diarize = async () =>
    Schema.decodeUnknownSync(PyannoteSegments)(
      await sherpaOnnx.offlineSpeakerDiarizationProcessAsync(diarization, samples, (done, total) =>
        report.progress(done / total),
      ),
    );
  let segments = await diarize();
  if (new Set(segments.map(({ speaker }) => speaker)).size > maxSpeakers) {
    sherpaOnnx.offlineSpeakerDiarizationSetConfig(diarization, {
      clustering: { numClusters: maxSpeakers, threshold: speakerDistanceThreshold },
    });
    segments = await diarize();
  }
  return segments.map(({ start, end, speaker }) => ({
    startMs: start * 1000,
    endMs: end * 1000,
    speaker,
  }));
}

async function diarizeWithSortformer(
  modelPath: string,
  samples: Float32Array,
  report: DiarizationReport,
) {
  const { TranscribeModel } = await import("transcribe-cpp");
  const model = await TranscribeModel.load(modelPath, { backend: "auto" });
  try {
    report.device(modelDevice(model));
    if (
      model.arch !== "sortformer" ||
      !model.roles.includes("diarize") ||
      model.diarizeInfo.sampleRate !== 16000
    )
      throw new Error("The speaker model does not support speaker turns for 16 kHz audio.");
    const session = model.createDiarizeSession();
    try {
      const segments = Schema.decodeUnknownSync(SortformerSegments)(
        await session.run(samples, {
          family: { kind: "sortformer_diarize", preset: "very_high_latency" },
        }),
      );
      return segments.map(({ t0Ms, t1Ms, speakerId }) => ({
        startMs: t0Ms,
        endMs: t1Ms,
        speaker: speakerId,
      }));
    } finally {
      session.dispose();
    }
  } finally {
    model.dispose();
  }
}

export async function diarizeSpeakers(
  diarizer: SpeakerDiarizer,
  pcm: Uint8Array,
  report: DiarizationReport,
) {
  const samples = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Schema.decodeUnknownSync(SpeakerTurns)(
    diarizer.model === "pyannote-wespeaker"
      ? await diarizeWithPyannote(diarizer.segmentation, diarizer.embedding, samples, report)
      : await diarizeWithSortformer(diarizer.diarization, samples, report),
  );
}
