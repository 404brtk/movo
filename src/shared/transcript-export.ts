import type { Transcript, TranscriptExportFormat } from "./contracts/transcriptions.ts";

export function transcriptText(transcript: Transcript) {
  return transcript.segments.map((segment) => segment.text.trim()).join("\n\n");
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
  const cues = transcript.segments.map((segment, index) => {
    const start = timestamp(segment.startMs, separator);
    const end = timestamp(Math.max(segment.endMs, segment.startMs + 1), separator);
    const text = segment.text
      .trim()
      .replace(/\s+/gu, " ")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    return `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
  });
  return (format === "vtt" ? "WEBVTT\n\n" : "") + cues.join("");
}
