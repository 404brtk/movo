import { readFile, writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { TranscribeModel } from "transcribe-cpp";
import { Transcript, TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";

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
    const pcm = await readFile(audioPath);
    if (pcm.length === 0 || pcm.length % 4 !== 0)
      throw new Error("Prepared audio is empty or incomplete.");
    console.log("MOVO_PHASE:transcribing");
    const result = await model.transcribe(pcm, { timestamps: "word" });
    if (result.aborted || result.truncated)
      throw new Error("The engine did not transcribe the whole recording.");
    if (result.timestampKind !== "word")
      throw new Error("The engine did not return word timestamps.");
    const transcript = Schema.decodeUnknownSync(Transcript)({
      language: result.language.trim() || null,
      words: result.words
        .filter((word) => word.text.trim())
        .map((word) => ({ startMs: word.t0Ms, endMs: word.t1Ms, text: word.text.trim() })),
    });
    if (result.text.trim() && transcript.words.length === 0)
      throw new Error("The engine returned text without timestamped words.");
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
