import type { Transcript } from "./contracts/transcriptions.ts";

export function transcriptSpeakers({ words, speakers = [] }: Transcript) {
  const ids = [
    ...new Set(words.flatMap((word) => (word.speaker === undefined ? [] : [word.speaker]))),
  ];
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.name]));
  return {
    ids,
    labeled: ids.length > 1 || ids.some((id) => names.has(id)),
    label: (id: number) => names.get(id) ?? `Speaker ${id}`,
    nameOf: (id: number) => names.get(id) ?? null,
    nextId: Math.max(0, ...ids, ...names.keys()) + 1,
  };
}

export type TranscriptSpeakers = ReturnType<typeof transcriptSpeakers>;
