import type { Transcript, TranscriptExportFormat } from "./contracts/transcriptions.ts";
import { transcriptPassages } from "./transcript-passages.ts";

export function transcriptText(transcript: Transcript) {
  return transcriptPassages(transcript.words)
    .map((passage) => passage.text)
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

export function exportTranscript(transcript: Transcript, format: TranscriptExportFormat) {
  if (format === "txt") return transcriptText(transcript);
  const separator = format === "srt" ? "," : ".";
  const cues = transcriptPassages(transcript.words).map((passage, index) => {
    const start = timestamp(passage.startMs, separator);
    const end = timestamp(Math.max(passage.endMs, passage.startMs + 1), separator);
    const text = passage.text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    return `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
  });
  return (format === "vtt" ? "WEBVTT\n\n" : "") + cues.join("");
}
