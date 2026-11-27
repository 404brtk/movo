import {
  defaultTranscriptExportOptions,
  type SpeakerNamePlacement,
  type Transcript,
  type TranscriptExportFormat,
  type TranscriptExportOptions,
} from "./contracts/transcriptions.ts";
import { timedLines } from "./chapters.ts";
import type { RecordingOverview } from "./contracts/overview.ts";
import { transcriptPassages, type TranscriptPassage } from "./transcript-passages.ts";
import { transcriptSpeakers } from "./transcript-speakers.ts";

type LabeledPassage = {
  passage: TranscriptPassage;
  speaker: string | null;
  turnStart: boolean;
  named: boolean;
};

export function labeledPassages(transcript: Transcript, placement: SpeakerNamePlacement = "turn") {
  const speakers = transcriptSpeakers(transcript);
  return transcriptPassages(transcript.words).map((passage, index, passages): LabeledPassage => {
    const speaker =
      placement !== "off" && speakers.labeled && passage.speaker !== undefined
        ? speakers.label(passage.speaker)
        : null;
    const turnStart = index === 0 || passages[index - 1]?.speaker !== passage.speaker;
    return {
      passage,
      speaker,
      turnStart,
      named: speaker !== null && (turnStart || placement === "line"),
    };
  });
}

function clockTime(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

const cueTime = (milliseconds: number, separator: "," | ".") =>
  clockTime(milliseconds) + separator + String(milliseconds % 1000).padStart(3, "0");

export function transcriptText(
  transcript: Transcript,
  { speakers, timestamps }: TranscriptExportOptions = defaultTranscriptExportOptions,
  spokenBy?: readonly number[],
) {
  return labeledPassages(transcript, speakers)
    .filter(
      ({ passage }) =>
        spokenBy === undefined ||
        (passage.speaker !== undefined && spokenBy.includes(passage.speaker)),
    )
    .map(({ passage, speaker, turnStart, named }, index) => {
      const turnGap = speaker !== null && turnStart && index > 0 ? "\n" : "";
      const time = timestamps ? `[${clockTime(passage.startMs)}] ` : "";
      return turnGap + time + (named ? `${speaker}: ` : "") + passage.text;
    })
    .join("\n");
}

const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function cueText(
  format: Exclude<TranscriptExportFormat, "txt">,
  { passage, speaker, named }: LabeledPassage,
) {
  const text = escaped(passage.text);
  if (speaker === null) return text;
  if (format === "vtt") return `<v ${escaped(speaker)}>${text}`;
  return named ? `${escaped(speaker)}: ${text}` : text;
}

export function overviewText({
  summary,
  chapters,
}: Pick<RecordingOverview, "summary" | "chapters">) {
  const sections = [
    ...(summary ? [`Summary\n${summary.text}`] : []),
    ...(summary?.keyPoints.length ? [`Key points\n${timedLines(summary.keyPoints)}`] : []),
    ...(chapters.length > 0
      ? [
          `Chapters\n${timedLines(chapters.map(({ startMs, title }) => ({ startMs, text: title })))}`,
        ]
      : []),
  ];
  return sections.map((section) => `${section}\n\n`).join("");
}

export function exportTranscript(
  transcript: Transcript,
  format: TranscriptExportFormat,
  options: TranscriptExportOptions = defaultTranscriptExportOptions,
  overview?: Pick<RecordingOverview, "summary" | "chapters">,
) {
  if (format === "txt")
    return (overview ? overviewText(overview) : "") + transcriptText(transcript, options);
  const separator = format === "srt" ? "," : ".";
  const cues = labeledPassages(transcript, options.speakers).map((cue, index) => {
    const start = cueTime(cue.passage.startMs, separator);
    const end = cueTime(Math.max(cue.passage.endMs, cue.passage.startMs + 1), separator);
    return `${index + 1}\n${start} --> ${end}\n${cueText(format, cue)}\n\n`;
  });
  return (format === "vtt" ? "WEBVTT\n\n" : "") + cues.join("");
}
