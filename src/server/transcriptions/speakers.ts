import { Schema } from "effect";
import {
  maxSpeakers,
  type Transcript,
  type TranscriptWord,
} from "../../shared/contracts/transcriptions.ts";

const Milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const SpeakerTurns = Schema.Array(
  Schema.Struct({
    startMs: Milliseconds,
    endMs: Milliseconds,
    speaker: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }).check(
    Schema.makeFilter((turn) => turn.endMs >= turn.startMs || "A turn ends before it starts."),
  ),
);
export type SpeakerTurn = (typeof SpeakerTurns.Type)[number];

function speakerTimelines(turns: readonly SpeakerTurn[]) {
  const timelines = new Map<number, SpeakerTurn[]>();
  for (const turn of turns) {
    const timeline = timelines.get(turn.speaker) ?? [];
    timeline.push(turn);
    timelines.set(turn.speaker, timeline);
  }
  return [...timelines].map(([speaker, timeline]) => ({
    speaker,
    turns: timeline.toSorted((first, second) => first.startMs - second.startMs),
    next: 0,
  }));
}

function closestSpeaker(word: TranscriptWord, timelines: ReturnType<typeof speakerTimelines>) {
  let best: { speaker: number; overlap: number; distance: number } | undefined;
  for (const timeline of timelines) {
    while ((timeline.turns[timeline.next]?.endMs ?? Number.POSITIVE_INFINITY) <= word.startMs)
      timeline.next++;
    let overlap = 0;
    for (let index = timeline.next; index < timeline.turns.length; index++) {
      const turn = timeline.turns[index];
      if (!turn || turn.startMs >= word.endMs) break;
      overlap += Math.min(turn.endMs, word.endMs) - Math.max(turn.startMs, word.startMs);
    }
    const following = timeline.turns[timeline.next];
    const preceding = timeline.turns[timeline.next - 1];
    const distance = Math.min(
      following ? Math.max(0, following.startMs - word.endMs) : Number.POSITIVE_INFINITY,
      preceding ? Math.max(0, word.startMs - preceding.endMs) : Number.POSITIVE_INFINITY,
    );
    if (
      !best ||
      overlap > best.overlap ||
      (overlap === best.overlap && overlap === 0 && distance < best.distance)
    )
      best = { speaker: timeline.speaker, overlap, distance };
  }
  return best?.speaker;
}

export function assignSpeakers(transcript: Transcript, turns: readonly SpeakerTurn[]): Transcript {
  const timelines = speakerTimelines(turns);
  if (timelines.length === 0) return transcript;
  const order = new Map<number, number>();
  return {
    ...transcript,
    words: transcript.words.map((word) => {
      const detected = closestSpeaker(word, timelines);
      if (detected === undefined) return word;
      const speaker = order.get(detected) ?? order.size + 1;
      if (speaker > maxSpeakers)
        throw new Error(
          `The recording has more than ${maxSpeakers} speakers, the most a transcript can label.`,
        );
      order.set(detected, speaker);
      return { ...word, speaker };
    }),
  };
}
