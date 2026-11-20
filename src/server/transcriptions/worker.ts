import { writeFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { Schema } from "effect";
import { TranscribeModel } from "transcribe-cpp";
import { TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";
import { readEngineTranscript } from "./engine-result.ts";
import { readPreparedAudio } from "./prepared-audio.ts";
import { assignSpeakers } from "./speakers.ts";

const ownerDisconnected = () => process.kill(process.pid, "SIGKILL");
process.once("disconnect", ownerDisconnected);

async function transcribe(modelPath: string, audioPath: string) {
  const model = await TranscribeModel.load(modelPath, { backend: "auto" });
  try {
    const device = Schema.decodeUnknownSync(TranscriptionDevice)({
      backend: model.device.kind,
      name: model.device.description.trim() || model.device.name,
    });
    console.log(`MOVO_DEVICE:${JSON.stringify(device)}`);
    if (
      model.arch !== "parakeet" ||
      !model.roles.includes("asr") ||
      model.capabilities.nativeSampleRate !== 16000 ||
      !["word", "token"].includes(model.capabilities.maxTimestampKind)
    )
      throw new Error("The model does not support the required transcription and word timestamps.");
    const pcm = await readPreparedAudio(audioPath);
    console.log("MOVO_PHASE:transcribing");
    const result = await model.transcribe(pcm, { timestamps: "word" });
    return { pcm, transcript: readEngineTranscript(result) };
  } finally {
    model.dispose();
  }
}

function speakerSegments(
  segmentationPath: string,
  embeddingPath: string,
  pcm: Buffer<ArrayBuffer>,
) {
  console.log("MOVO_PHASE:speakers");
  const script = new URL(
    import.meta.url.endsWith(".ts") ? "./speaker-worker.ts" : "./speaker-worker.js",
    import.meta.url,
  );
  const worker = new Worker(script, {
    workerData: { segmentationPath, embeddingPath, pcm },
    transferList: [pcm.buffer],
  });
  return new Promise<unknown>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) =>
      reject(new Error(`The speaker worker exited without a result (code ${code}).`)),
    );
  });
}

try {
  if (!process.connected) throw new Error("The transcription worker must be started by Movo.");
  const [, , modelPath, audioPath, resultPath, ...speakerPaths] = process.argv;
  const [segmentationPath, embeddingPath] = speakerPaths;
  if (!modelPath || !audioPath || !resultPath || ![0, 2].includes(speakerPaths.length))
    throw new Error("Missing transcription worker arguments.");
  console.log("MOVO_PHASE:loading");
  const { pcm, transcript } = await transcribe(modelPath, audioPath);
  const result =
    segmentationPath && embeddingPath && transcript.words.length > 0
      ? assignSpeakers(transcript, await speakerSegments(segmentationPath, embeddingPath, pcm))
      : transcript;
  await writeFile(resultPath, JSON.stringify(result), { flag: "wx" });
} catch (cause) {
  console.error(
    `ERROR: ${cause instanceof Error ? cause.message : "Could not transcribe this recording."}`,
  );
  process.exitCode = 1;
} finally {
  process.off("disconnect", ownerDisconnected);
  if (process.connected) process.disconnect?.();
}
