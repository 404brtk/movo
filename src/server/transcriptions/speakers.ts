import { Schema } from "effect";
import {
  maxSpeakers,
  type Transcript,
  type TranscriptWord,
} from "../../shared/contracts/transcriptions.ts";

const Seconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const SpeakerSegments = Schema.Array(
  Schema.Struct({
    start: Seconds,
    end: Seconds,
    speaker: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }).check(
    Schema.makeFilter((segment) => segment.end >= segment.start || "A turn ends before it starts."),
  ),
);
interface SpeakerTurn {
  t0Ms: number;
  t1Ms: number;
}

function speakerTimelines(segments: typeof SpeakerSegments.Type) {
  const timelines = new Map<number, SpeakerTurn[]>();
  for (const { start, end, speaker } of segments) {
    const timeline = timelines.get(speaker) ?? [];
    timeline.push({ t0Ms: start * 1000, t1Ms: end * 1000 });
    timelines.set(speaker, timeline);
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

export function assignSpeakers(transcript: Transcript, engineSegments: unknown): Transcript {
  const timelines = speakerTimelines(Schema.decodeUnknownSync(SpeakerSegments)(engineSegments));
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
