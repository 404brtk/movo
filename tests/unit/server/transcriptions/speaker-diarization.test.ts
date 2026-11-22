import { beforeEach, expect, it, vi } from "vitest";
import { maxSpeakers } from "../../../../src/shared/contracts/transcriptions.ts";
import { diarizeSpeakers } from "../../../../src/server/transcriptions/speaker-diarization.ts";
import { assignSpeakers } from "../../../../src/server/transcriptions/speakers.ts";

const { processAudio, setConfig, sortformer } = vi.hoisted(() => ({
  processAudio:
    vi.fn<
      (
        handle: object,
        samples: Float32Array,
        progress: (done: number, total: number) => void,
      ) => Promise<unknown>
    >(),
  setConfig: vi.fn<(handle: object, config: unknown) => void>(),
  sortformer: {
    run: vi.fn<(samples: Float32Array, options: unknown) => Promise<unknown>>(),
    arch: "sortformer",
    disposed: [] as string[],
  },
}));

vi.mock("sherpa-onnx-node/addon.js", () => ({
  default: {
    createOfflineSpeakerDiarization: () => ({}),
    getOfflineSpeakerDiarizationSampleRate: () => 16000,
    offlineSpeakerDiarizationSetConfig: setConfig,
    offlineSpeakerDiarizationProcessAsync: processAudio,
  },
}));

vi.mock("transcribe-cpp", () => ({
  TranscribeModel: {
    load: async () => ({
      arch: sortformer.arch,
      roles: ["diarize"],
      diarizeInfo: { sampleRate: 16000, maxSpeakers: 4 },
      createDiarizeSession: () => ({
        run: sortformer.run,
        dispose: () => sortformer.disposed.push("session"),
      }),
      dispose: () => sortformer.disposed.push("model"),
    }),
  },
}));

const pyannote = {
  model: "pyannote-wespeaker",
  segmentation: "segmentation.onnx",
  embedding: "embedding.onnx",
} as const;
const sortformerFiles = { model: "sortformer-4spk-q8", diarization: "sortformer.gguf" } as const;
const audio = Buffer.alloc(16 * Float32Array.BYTES_PER_ELEMENT);

beforeEach(() => {
  processAudio.mockReset();
  setConfig.mockClear();
  sortformer.run.mockReset();
  sortformer.arch = "sortformer";
  sortformer.disposed = [];
});

it.each([
  [maxSpeakers, 1],
  [maxSpeakers + 1, 2],
])("labels a transcript after Pyannote detects %i speakers", async (count, passes) => {
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
    await diarizeSpeakers(pyannote, audio, () => {}),
  );
  expect(actual.words).toEqual(
    words.map((word, index) => ({ ...word, speaker: Math.min(index + 1, maxSpeakers) })),
  );
  expect(setConfig.mock.calls.map(([, config]) => config)).toEqual(
    passes === 2 ? [{ clustering: { numClusters: maxSpeakers, threshold: 0.5 } }] : [],
  );
  expect(processAudio).toHaveBeenCalledTimes(passes);
});

it("reports the share of audio chunks Pyannote has processed", async () => {
  processAudio.mockImplementationOnce(async (_handle, _samples, progress) => {
    progress(1, 4);
    progress(4, 4);
    return [];
  });
  const reported: number[] = [];
  await diarizeSpeakers(pyannote, audio, (fraction) => reported.push(fraction));
  expect(reported).toEqual([0.25, 1]);
});

it("reads Sortformer turns in milliseconds with the offline preset and releases the model", async () => {
  sortformer.run.mockResolvedValueOnce([
    { t0Ms: 0, t1Ms: 900, speakerId: 2, p: Number.NaN },
    { t0Ms: 900, t1Ms: 1500, speakerId: 1, p: Number.NaN },
  ]);
  expect(await diarizeSpeakers(sortformerFiles, audio, () => {})).toEqual([
    { startMs: 0, endMs: 900, speaker: 2 },
    { startMs: 900, endMs: 1500, speaker: 1 },
  ]);
  expect(sortformer.run.mock.calls[0]?.[1]).toEqual({
    family: { kind: "sortformer_diarize", preset: "very_high_latency" },
  });
  expect(sortformer.disposed).toEqual(["session", "model"]);
});

it("rejects a GGUF file that is not a Sortformer speaker model", async () => {
  sortformer.arch = "parakeet";
  await expect(diarizeSpeakers(sortformerFiles, audio, () => {})).rejects.toThrow(
    /does not support speaker turns/u,
  );
  expect(sortformer.disposed).toEqual(["model"]);
});

it.each([
  {
    name: "a reversed Pyannote turn",
    diarizer: pyannote,
    turns: [{ start: 0.5, end: 0.1, speaker: 0 }],
    cause: /ends before it starts/u,
  },
  {
    name: "a negative Pyannote speaker",
    diarizer: pyannote,
    turns: [{ start: 0, end: 0.1, speaker: -1 }],
    cause: /greater than or equal to 0/u,
  },
  {
    name: "an unreadable Pyannote value",
    diarizer: pyannote,
    turns: [{ start: "0", end: 0.1, speaker: 0 }],
    cause: /Expected number/u,
  },
  {
    name: "a fractional Sortformer speaker",
    diarizer: sortformerFiles,
    turns: [{ t0Ms: 0, t1Ms: 100, speakerId: 1.5 }],
    cause: /integer/u,
  },
])("rejects $name", async ({ diarizer, turns, cause }) => {
  processAudio.mockResolvedValueOnce(turns);
  sortformer.run.mockResolvedValueOnce(turns);
  await expect(diarizeSpeakers(diarizer, audio, () => {})).rejects.toThrow(cause);
});
