import { Schema } from "effect";
import type { Transcript, TranscriptWord } from "../../shared/contracts/transcriptions.ts";

const Milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const SpeakerTurns = Schema.Array(
  Schema.Struct({
    t0Ms: Milliseconds,
    t1Ms: Milliseconds,
    speakerId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  }).check(Schema.makeFilter((turn) => turn.t1Ms >= turn.t0Ms || "A turn ends before it starts.")),
);
type SpeakerTurn = (typeof SpeakerTurns.Type)[number];

function speakerTimelines(turns: readonly SpeakerTurn[]) {
  const timelines = new Map<number, SpeakerTurn[]>();
  for (const turn of turns) {
    const timeline = timelines.get(turn.speakerId) ?? [];
    timeline.push(turn);
    timelines.set(turn.speakerId, timeline);
  }
  return [...timelines].map(([speaker, timeline]) => ({
    speaker,
    turns: timeline.toSorted((first, second) => first.t0Ms - second.t0Ms),
    next: 0,
  }));
}

function closestSpeaker(word: TranscriptWord, timelines: ReturnType<typeof speakerTimelines>) {
  let best: { speaker: number; overlap: number; distance: number } | undefined;
  for (const timeline of timelines) {
    while ((timeline.turns[timeline.next]?.t1Ms ?? Number.POSITIVE_INFINITY) <= word.startMs)
      timeline.next++;
    let overlap = 0;
    for (let index = timeline.next; index < timeline.turns.length; index++) {
      const turn = timeline.turns[index];
      if (!turn || turn.t0Ms >= word.endMs) break;
      overlap += Math.min(turn.t1Ms, word.endMs) - Math.max(turn.t0Ms, word.startMs);
    }
    const following = timeline.turns[timeline.next];
    const preceding = timeline.turns[timeline.next - 1];
    const distance = Math.min(
      following ? Math.max(0, following.t0Ms - word.endMs) : Number.POSITIVE_INFINITY,
      preceding ? Math.max(0, word.startMs - preceding.t1Ms) : Number.POSITIVE_INFINITY,
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

export function assignSpeakers(transcript: Transcript, engineTurns: unknown): Transcript {
  const timelines = speakerTimelines(Schema.decodeUnknownSync(SpeakerTurns)(engineTurns));
  if (timelines.length === 0) return transcript;
  const order = new Map<number, number>();
  return {
    ...transcript,
    words: transcript.words.map((word) => {
      const detected = closestSpeaker(word, timelines);
      if (detected === undefined) return word;
      const speaker = order.get(detected) ?? order.size + 1;
      order.set(detected, speaker);
      return { ...word, speaker };
    }),
  };
}
