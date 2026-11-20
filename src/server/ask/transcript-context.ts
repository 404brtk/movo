import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { labeledPassages } from "../../shared/transcript-export.ts";

export interface TranscriptContext {
  title: string;
  lines: string[];
  text: string;
  moments: number[];
}

const transcriptData = (text: string) => text.replaceAll("<", "&lt;");

export function transcriptContext(
  title: string,
  revision: number,
  transcript: Transcript,
): TranscriptContext {
  const passages = labeledPassages(transcript);
  const escapedTitle = transcriptData(title);
  const language = transcript.language ? `, language ${transcriptData(transcript.language)}` : "";
  const lines = passages.map(({ passage, speaker, turnStart }) =>
    transcriptData(
      `[${passage.startMs}] ${speaker !== null && turnStart ? `${speaker}: ` : ""}${passage.text}`,
    ),
  );
  const speakers = passages.some(({ speaker }) => speaker !== null)
    ? " A speaker's name starts each change of speaker."
    : "";
  return {
    title: escapedTitle,
    lines,
    text: [
      `The whole transcript of "${escapedTitle}" (revision ${revision}${language}). Each line is a passage that starts with its startMs in square brackets.${speakers}`,
      "<transcript>",
      ...lines,
      "</transcript>",
    ].join("\n"),
    moments: [...new Set(passages.map(({ passage }) => passage.startMs))],
  };
}
