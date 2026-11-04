import { readFile, writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { getAvailableBackendsAsync, TranscribeModel } from "transcribe-cpp";
import { Transcript } from "../../shared/contracts/transcriptions.ts";

const ownerDisconnected = () => process.exit(1);
process.once("disconnect", ownerDisconnected);

try {
  if (!process.connected) throw new Error("The transcription worker must be started by Movo.");
  const [, , modelPath, audioPath, resultPath] = process.argv;
  if (!modelPath || !audioPath || !resultPath)
    throw new Error("Missing transcription worker arguments.");
  console.log("MOVO_PHASE:loading");
  const devices = await getAvailableBackendsAsync();
  const device = devices.find((entry) => entry.deviceType === "cpu");
  if (!device) throw new Error("No CPU inference backend is available.");
  const model = await TranscribeModel.load(modelPath, { device });
  try {
    if (
      model.arch !== "parakeet" ||
      !model.roles.includes("asr") ||
      model.capabilities.nativeSampleRate !== 16000 ||
      model.capabilities.maxTimestampKind === "none"
    )
      throw new Error("The model does not support the required transcription and timestamps.");
    const pcm = await readFile(audioPath);
    if (pcm.length === 0 || pcm.length % 4 !== 0)
      throw new Error("Prepared audio is empty or incomplete.");
    console.log("MOVO_PHASE:transcribing");
    const result = await model.transcribe(pcm, { timestamps: "segment" });
    if (result.aborted || result.truncated)
      throw new Error("The engine did not transcribe the whole recording.");
    const transcript = Schema.decodeUnknownSync(Transcript)({
      language: result.language.trim() || null,
      segments: result.segments
        .filter((segment) => segment.text.trim())
        .map((segment) => ({
          startMs: segment.t0Ms,
          endMs: segment.t1Ms,
          text: segment.text.trim(),
        })),
    });
    if (result.text.trim() && transcript.segments.length === 0)
      throw new Error("The engine returned text without timestamped passages.");
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
