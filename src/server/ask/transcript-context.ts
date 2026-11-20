import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { labeledPassages } from "../../shared/transcript-export.ts";

export interface TranscriptContext {
  text: string;
  moments: number[];
}

export function transcriptContext(
  title: string,
  revision: number,
  transcript: Transcript,
): TranscriptContext {
  const passages = labeledPassages(transcript);
  const language = transcript.language ? `, language ${transcript.language}` : "";
  const lines = passages.map(
    ({ passage, speaker, turnStart }) =>
      `[${passage.startMs}] ${speaker !== null && turnStart ? `${speaker}: ` : ""}${passage.text}`,
  );
  const speakers = passages.some(({ speaker }) => speaker !== null)
    ? " A speaker's name starts each change of speaker."
    : "";
  return {
    text: [
      `The whole transcript of "${title}" (revision ${revision}${language}). Each line is a passage that starts with its startMs in square brackets.${speakers}`,
      "<transcript>",
      ...lines,
      "</transcript>",
    ].join("\n"),
    moments: [...new Set(passages.map(({ passage }) => passage.startMs))],
  };
}
