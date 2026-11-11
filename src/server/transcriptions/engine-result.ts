import { Schema } from "effect";
import type { TranscriptionResult } from "transcribe-cpp";
import { Transcript } from "../../shared/contracts/transcriptions.ts";

export function readEngineTranscript(result: TranscriptionResult) {
  if (result.aborted || result.truncated)
    throw new Error("The engine did not transcribe the whole recording.");
  const spokenWords = result.words.filter((word) => word.text.trim());
  const heardSpeech = result.text.trim() !== "" || spokenWords.length > 0;
  if (heardSpeech && result.timestampKind !== "word")
    throw new Error("The engine did not return word timestamps.");
  const transcript = Schema.decodeUnknownSync(Transcript)({
    language: result.language.trim() || null,
    words: spokenWords.map((word) => ({
      startMs: word.t0Ms,
      endMs: word.t1Ms,
      text: word.text.trim(),
    })),
  });
  if (heardSpeech && transcript.words.length === 0)
    throw new Error("The engine returned text without timestamped words.");
  return transcript;
}
