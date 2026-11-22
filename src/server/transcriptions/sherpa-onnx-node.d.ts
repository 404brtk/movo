declare module "sherpa-onnx-node/addon.js" {
  interface ClusteringConfig {
    numClusters: number;
    threshold: number;
  }

  interface OfflineSpeakerDiarizationConfig {
    segmentation: { pyannote: { model: string }; numThreads: number };
    embedding: { model: string; numThreads: number };
    clustering: ClusteringConfig;
  }

  type OfflineSpeakerDiarizationHandle = object & { readonly brand: unique symbol };

  const addon: {
    createOfflineSpeakerDiarization(
      config: OfflineSpeakerDiarizationConfig,
    ): OfflineSpeakerDiarizationHandle;
    getOfflineSpeakerDiarizationSampleRate(handle: OfflineSpeakerDiarizationHandle): number;
    offlineSpeakerDiarizationSetConfig(
      handle: OfflineSpeakerDiarizationHandle,
      config: { clustering: ClusteringConfig },
    ): void;
    offlineSpeakerDiarizationProcessAsync(
      handle: OfflineSpeakerDiarizationHandle,
      samples: Float32Array,
      progress: (processedChunks: number, totalChunks: number) => void,
    ): Promise<unknown>;
  };
  export default addon;
}
