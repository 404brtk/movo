import { expect, it, vi } from "vitest";
import { maxSpeakers } from "../../../../src/shared/contracts/transcriptions.ts";
import { diarizeSpeakers } from "../../../../src/server/transcriptions/speaker-diarization.ts";
import { assignSpeakers } from "../../../../src/server/transcriptions/speakers.ts";

const { processAudio, setConfig } = vi.hoisted(() => ({
  processAudio:
    vi.fn<
      (
        handle: object,
        samples: Float32Array,
        progress: (done: number, total: number) => void,
      ) => Promise<unknown>
    >(),
  setConfig: vi.fn<(handle: object, config: unknown) => void>(),
}));

vi.mock("sherpa-onnx-node/addon.js", () => ({
  default: {
    createOfflineSpeakerDiarization: () => ({}),
    getOfflineSpeakerDiarizationSampleRate: () => 16000,
    offlineSpeakerDiarizationSetConfig: setConfig,
    offlineSpeakerDiarizationProcessAsync: processAudio,
  },
}));

it.each([
  [maxSpeakers, 1],
  [maxSpeakers + 1, 2],
])("labels a transcript after detecting %i speakers", async (count, passes) => {
  processAudio.mockReset();
  setConfig.mockClear();
  const turns = Array.from({ length: count }, (_, speaker) => ({
    start: speaker,
    end: speaker + 1,
    speaker,
  }));
  const words = turns.map(({ start, end }) => ({
    startMs: start * 1000,
    endMs: end * 1000,
    text: "Hello",
  }));
  processAudio
    .mockResolvedValueOnce(turns)
    .mockResolvedValueOnce(
      turns.map((turn) => ({ ...turn, speaker: Math.min(turn.speaker, maxSpeakers - 1) })),
    );
  const actual = assignSpeakers(
    { language: "en", words },
    await diarizeSpeakers("segmentation.onnx", "embedding.onnx", Buffer.alloc(4), () => {}),
  );
  expect(actual.words).toEqual(
    words.map((word, index) => ({ ...word, speaker: Math.min(index + 1, maxSpeakers) })),
  );
  expect(setConfig.mock.calls.map(([, config]) => config)).toEqual(
    passes === 2 ? [{ clustering: { numClusters: maxSpeakers, threshold: 0.5 } }] : [],
  );
  expect(processAudio).toHaveBeenCalledTimes(passes);
});

it("reports the share of processed audio chunks", async () => {
  processAudio.mockReset();
  processAudio.mockImplementationOnce(async (_handle, _samples, progress) => {
    progress(1, 4);
    progress(4, 4);
    return [];
  });
  const reported: number[] = [];
  await diarizeSpeakers("segmentation.onnx", "embedding.onnx", Buffer.alloc(4), (fraction) =>
    reported.push(fraction),
  );
  expect(reported).toEqual([0.25, 1]);
});
