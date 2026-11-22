import { writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { TranscribeModel } from "transcribe-cpp";
import { TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";
import { readEngineTranscript } from "./engine-result.ts";
import { readPreparedAudio } from "./prepared-audio.ts";
import { diarizeSpeakers, SpeakerDiarizer } from "./speaker-diarization.ts";
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

function speakerTurns(diarizer: SpeakerDiarizer, pcm: Buffer) {
  console.log("MOVO_PHASE:speakers");
  let reportedPercent = -1;
  return diarizeSpeakers(diarizer, pcm, (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent === reportedPercent) return;
    reportedPercent = percent;
    console.log(`MOVO_PROGRESS:${percent}`);
  });
}

try {
  if (!process.connected) throw new Error("The transcription worker must be started by Movo.");
  const [, , modelPath, audioPath, resultPath, speakerModel, ...unexpected] = process.argv;
  if (!modelPath || !audioPath || !resultPath || unexpected.length > 0)
    throw new Error("Missing transcription worker arguments.");
  const diarizer =
    speakerModel === undefined
      ? null
      : Schema.decodeUnknownSync(Schema.fromJsonString(SpeakerDiarizer))(speakerModel);
  console.log("MOVO_PHASE:loading");
  const { pcm, transcript } = await transcribe(modelPath, audioPath);
  const result =
    diarizer && transcript.words.length > 0
      ? assignSpeakers(transcript, await speakerTurns(diarizer, pcm))
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
