import type { Transcript, TranscriptExportFormat } from "./contracts/transcriptions.ts";
import { transcriptPassages, type TranscriptPassage } from "./transcript-passages.ts";
import { transcriptSpeakers } from "./transcript-speakers.ts";

function labeledPassages(transcript: Transcript) {
  const speakers = transcriptSpeakers(transcript);
  return transcriptPassages(transcript.words).map((passage, index, passages) => ({
    passage,
    speaker:
      speakers.labeled && passage.speaker !== undefined ? speakers.label(passage.speaker) : null,
    turnStart: index === 0 || passages[index - 1]?.speaker !== passage.speaker,
  }));
}

export function transcriptText(transcript: Transcript) {
  return labeledPassages(transcript)
    .map(({ passage, speaker, turnStart }, index) =>
      speaker === null
        ? passage.text
        : turnStart
          ? `${index === 0 ? "" : "\n"}${speaker}: ${passage.text}`
          : passage.text,
    )
    .join("\n");
}

function timestamp(milliseconds: number, separator: "," | ".") {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return (
    [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":") +
    separator +
    String(milliseconds % 1000).padStart(3, "0")
  );
}

const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function cueText(
  format: Exclude<TranscriptExportFormat, "txt">,
  {
    passage,
    speaker,
    turnStart,
  }: { passage: TranscriptPassage; speaker: string | null; turnStart: boolean },
) {
  const text = escaped(passage.text);
  if (speaker === null) return text;
  if (format === "vtt") return `<v ${escaped(speaker)}>${text}`;
  return turnStart ? `${escaped(speaker)}: ${text}` : text;
}

export function exportTranscript(transcript: Transcript, format: TranscriptExportFormat) {
  if (format === "txt") return transcriptText(transcript);
  const separator = format === "srt" ? "," : ".";
  const cues = labeledPassages(transcript).map((cue, index) => {
    const start = timestamp(cue.passage.startMs, separator);
    const end = timestamp(Math.max(cue.passage.endMs, cue.passage.startMs + 1), separator);
    return `${index + 1}\n${start} --> ${end}\n${cueText(format, cue)}\n\n`;
  });
  return (format === "vtt" ? "WEBVTT\n\n" : "") + cues.join("");
}
