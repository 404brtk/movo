import { writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { TranscribeModel } from "transcribe-cpp";
import { TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";
import { readEngineTranscript } from "./engine-result.ts";
import { readPreparedAudio } from "./prepared-audio.ts";

const ownerDisconnected = () => process.exit(1);
process.once("disconnect", ownerDisconnected);

try {
  if (!process.connected) throw new Error("The transcription worker must be started by Movo.");
  const [, , modelPath, audioPath, resultPath] = process.argv;
  if (!modelPath || !audioPath || !resultPath)
    throw new Error("Missing transcription worker arguments.");
  console.log("MOVO_PHASE:loading");
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
    const transcript = readEngineTranscript(result);
    await writeFile(resultPath, JSON.stringify(transcript), { flag: "wx" });
  } finally {
    model.dispose();
  }
} catch (cause) {
  console.error(
    `ERROR: ${cause instanceof Error ? cause.message : "Could not transcribe this recording."}`,
  );
  process.exitCode = 1;
} finally {
  process.off("disconnect", ownerDisconnected);
  if (process.connected) process.disconnect?.();
}
