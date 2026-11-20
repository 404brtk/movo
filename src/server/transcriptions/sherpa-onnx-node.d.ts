declare module "sherpa-onnx-node" {
  interface OfflineSpeakerDiarizationConfig {
    segmentation: { pyannote: { model: string }; numThreads: number };
    embedding: { model: string; numThreads: number };
    clustering: { numClusters: number; threshold: number };
  }

  class OfflineSpeakerDiarization {
    constructor(config: OfflineSpeakerDiarizationConfig);
    readonly sampleRate: number;
    process(samples: Float32Array): unknown;
    setConfig(config: Pick<OfflineSpeakerDiarizationConfig, "clustering">): void;
  }

  const sherpaOnnx: { OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization };
  export default sherpaOnnx;
}
