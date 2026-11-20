import { expect, it, vi } from "vitest";
import { maxSpeakers } from "../../../../src/shared/contracts/transcriptions.ts";
import { diarizeSpeakers } from "../../../../src/server/transcriptions/speaker-diarization.ts";
import { assignSpeakers } from "../../../../src/server/transcriptions/speakers.ts";

const { processAudio, setConfig } = vi.hoisted(() => ({
  processAudio: vi.fn<(samples: Float32Array) => unknown>(),
  setConfig: vi.fn<(config: unknown) => void>(),
}));

vi.mock("sherpa-onnx-node", () => ({
  default: {
    OfflineSpeakerDiarization: class {
      sampleRate = 16000;
      process = processAudio;
      setConfig = setConfig;
    },
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
    .mockReturnValueOnce(turns)
    .mockReturnValueOnce(
      turns.map((turn) => ({ ...turn, speaker: Math.min(turn.speaker, maxSpeakers - 1) })),
    );
  const actual = assignSpeakers(
    { language: "en", words },
    await diarizeSpeakers("segmentation.onnx", "embedding.onnx", Buffer.alloc(4)),
  );
  expect(actual.words).toEqual(
    words.map((word, index) => ({ ...word, speaker: Math.min(index + 1, maxSpeakers) })),
  );
  expect(setConfig.mock.calls).toEqual(
    passes === 2 ? [[{ clustering: { numClusters: maxSpeakers, threshold: 0.5 } }]] : [],
  );
  expect(processAudio).toHaveBeenCalledTimes(passes);
});
