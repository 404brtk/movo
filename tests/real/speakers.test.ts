import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { transcriptionModel } from "../../src/server/models/catalog.ts";
import { createModels } from "../../src/server/models/models.ts";
import { runCommand } from "../../src/server/process/command.ts";
import type { SpeakerModelId } from "../../src/shared/contracts/models.ts";
import { Transcript } from "../../src/shared/contracts/transcriptions.ts";
import { openTestDatabase } from "../helpers/test-database.ts";

async function startWorker(speakerModelId: SpeakerModelId, repetitions: number) {
  const directory = await mkdtemp(join(tmpdir(), "movo-real-speakers-"));
  const { database, close } = await openTestDatabase(directory);
  const models = createModels({ database });
  let stopWorker: (() => Promise<void>) | undefined;
  onTestFinished(async () => {
    await stopWorker?.();
    await Effect.runPromise(models.close());
    await close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const { transcription } = await Effect.runPromise(models.resolve(transcriptionModel.id));
  const speakerFiles = await Effect.runPromise(models.resolve(speakerModelId));
  if (!transcription) throw new Error("The real speaker test needs the transcription model.");
  const pcm = join(directory, "audio.f32");
  const resultPath = join(directory, "result.json");
  const tools = createMediaTools({ dataDirectory: directory });
  const ffmpeg = await Effect.runPromise(tools.resolve("ffmpeg"));
  await Effect.runPromise(
    runCommand(
      ffmpeg,
      [
        "-nostdin",
        "-v",
        "error",
        "-n",
        "-stream_loop",
        String(repetitions - 1),
        "-i",
        fileURLToPath(new URL("../fixtures/speech.wav", import.meta.url)),
        "-f",
        "f32le",
        pcm,
      ],
      { timeoutMs: 15000 },
    ),
  );
  const worker = fork(
    fileURLToPath(new URL("../../src/server/transcriptions/worker.ts", import.meta.url)),
    [transcription, pcm, resultPath, JSON.stringify({ model: speakerModelId, ...speakerFiles })],
    { silent: true, execArgv: [] },
  );
  let stdout = "";
  let stderr = "";
  worker.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  worker.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  stopWorker = async () => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    try {
      await exited;
    } finally {
      worker.stdout?.destroy();
      worker.stderr?.destroy();
    }
  };
  return { worker, exited, resultPath, stdout: () => stdout, stderr: () => stderr };
}

it.for(["sortformer-4spk-q8", "pyannote-wespeaker"] as const)(
  "labels synthetic speech with the pinned %s files",
  async (speakerModelId) => {
    const { exited, resultPath, stderr } = await startWorker(speakerModelId, 1);
    const code = await exited;
    if (code !== 0)
      throw new Error(`The transcription worker exited with code ${code}. ${stderr()}`);
    const transcript = Schema.decodeUnknownSync(Transcript)(
      JSON.parse(await readFile(resultPath, "utf8")),
    );
    expect(
      transcript.words
        .map((word) => word.text)
        .join(" ")
        .toLowerCase(),
    ).toContain("transcription");
    expect([...new Set(transcript.words.map((word) => word.speaker))]).toEqual([1]);
  },
);

it("stops promptly when the worker loses its owner during real Pyannote inference", async () => {
  const { worker, resultPath, stdout, stderr } = await startWorker("pyannote-wespeaker", 23);
  await expect
    .poll(() => stdout(), { timeout: 180000, interval: 100 })
    .toContain("MOVO_PHASE:speakers");
  await setTimeout(750);
  if (!worker.connected) throw new Error(`The transcription worker exited early. ${stderr()}`);
  worker.disconnect();
  await expect
    .poll(() => worker.exitCode !== null || worker.signalCode !== null, { timeout: 2000 })
    .toBe(true);
  expect(worker.exitCode).not.toBe(0);
  await expect(readFile(resultPath)).rejects.toMatchObject({ code: "ENOENT" });
});
