import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { createMediaTools } from "../../../../src/server/media-tools/tools.ts";
import { runCommand } from "../../../../src/server/process/command.ts";
import { createTranscriptionEngine } from "../../../../src/server/transcriptions/engine.ts";

const deviceReport = 'MOVO_DEVICE:{"backend":"vulkan","name":"Test GPU"}';

it.for(["tone.wav", "sample.webm"])(
  "prepares real %s audio and validates the isolated engine result",
  async (filename) => {
    const directory = await mkdtemp(join(tmpdir(), "movo-transcription-engine-"));
    onTestFinished(() =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    );
    const source = new URL(`../../../fixtures/${filename}`, import.meta.url);
    const original = readFileSync(source);
    const staging = join(directory, "work");
    await mkdir(staging);
    const expected = {
      language: null,
      words: [
        { startMs: 50, endMs: 700, text: "Prepared" },
        { startMs: 700, endMs: 1500, text: "audio." },
      ],
    };
    const phases: string[] = [];
    const devices: unknown[] = [];
    let prepared = Buffer.alloc(0);
    const tools = createMediaTools({ dataDirectory: directory });
    const engine = createTranscriptionEngine(
      tools,
      { resolve: () => Effect.succeed("verified-model.gguf") },
      (file, args, options) =>
        file === process.execPath
          ? Effect.promise(async () => {
              prepared = await readFile(args[2] ?? "");
              options.onLine?.("MOVO_PHASE:loading");
              options.onLine?.(deviceReport);
              options.onLine?.("MOVO_PHASE:transcribing");
              await writeFile(args[3] ?? "", JSON.stringify(expected), { flag: "wx" });
              return "";
            })
          : runCommand(file, args, options),
    );
    await Effect.runPromise(engine.check());
    const result = await Effect.runPromise(
      engine.transcribe(
        fileURLToPath(source),
        staging,
        (phase) => phases.push(phase),
        (device) => devices.push(device),
      ),
    );
    expect(result).toEqual(expected);
    expect(phases).toEqual(["preparing", "loading", "transcribing"]);
    expect(devices).toEqual([{ backend: "vulkan", name: "Test GPU" }]);
    expect(prepared.length).toBe(2 * 16000 * 4);
    const samples = new Float32Array(prepared.buffer, prepared.byteOffset, prepared.byteLength / 4);
    expect(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
    expect(samples.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
    expect(await readFile(source)).toEqual(original);
  },
);

it.for([
  {
    name: "a result without a reported device",
    reportsDevice: false,
    payload: JSON.stringify({ language: null, words: [] }),
    cause: /did not report its device/u,
  },
  { name: "unreadable JSON", reportsDevice: true, payload: "{", cause: /JSON/u },
  {
    name: "reversed timestamps",
    reportsDevice: true,
    cause: /ends before it starts/u,
    payload: JSON.stringify({
      language: null,
      words: [{ startMs: 1000, endMs: 100, text: "Invalid" }],
    }),
  },
  {
    name: "unordered words",
    reportsDevice: true,
    cause: /not in time order/u,
    payload: JSON.stringify({
      language: null,
      words: [
        { startMs: 1000, endMs: 1500, text: "Later" },
        { startMs: 100, endMs: 500, text: "Earlier" },
      ],
    }),
  },
  {
    name: "a word containing whitespace",
    reportsDevice: true,
    cause: /\\S\+/u,
    payload: JSON.stringify({
      language: null,
      words: [{ startMs: 0, endMs: 500, text: "two words" }],
    }),
  },
])("rejects $name from the worker", async ({ reportsDevice, payload, cause }) => {
  const directory = await mkdtemp(join(tmpdir(), "movo-transcription-result-"));
  onTestFinished(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  );
  const tools = createMediaTools({ dataDirectory: directory });
  const engine = createTranscriptionEngine(
    tools,
    { resolve: () => Effect.succeed("verified-model.gguf") },
    (file, args, options) =>
      Effect.promise(async () => {
        if (file === process.execPath) {
          if (reportsDevice) options.onLine?.(deviceReport);
          await writeFile(args[3] ?? "", payload, { flag: "wx" });
        }
        return "";
      }),
  );
  await expect(
    Effect.runPromise(
      engine.transcribe(
        "recording.wav",
        directory,
        () => undefined,
        () => undefined,
      ),
    ),
  ).rejects.toMatchObject({
    reason: "unsupported",
    message: "The transcription engine returned an invalid result.",
    cause: { message: expect.stringMatching(cause) },
  });
});
