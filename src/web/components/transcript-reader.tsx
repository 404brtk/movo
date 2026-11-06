import { Fragment, memo, useMemo } from "react";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { transcriptPassages, type TranscriptPassage } from "../../shared/transcript-passages.ts";
import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

const Passage = memo(function Passage({
  passage,
  currentWord,
  onSeek,
}: {
  passage: TranscriptPassage;
  currentWord: number;
  onSeek: (milliseconds: number) => void;
}) {
  const current = currentWord >= 0;
  return (
    <li
      aria-current={current ? "time" : undefined}
      className={cn("flex gap-4 px-5 py-4 transition-colors sm:gap-6", current && "bg-muted")}
    >
      <button
        type="button"
        aria-label={`Go to ${formatDuration(passage.startMs / 1000)}`}
        className="min-h-10 shrink-0 self-start rounded-sm text-sm text-muted-foreground tabular-nums underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        onClick={() => onSeek(passage.startMs)}
      >
        {formatDuration(passage.startMs / 1000)}
      </button>
      <p className="min-w-0 py-2 text-sm leading-7 wrap-anywhere">
        {current
          ? passage.words.map((word, index) => (
              <Fragment key={index}>
                {index > 0 ? " " : null}
                {index === currentWord ? (
                  <mark className="rounded-sm bg-primary/15 text-foreground">{word.text}</mark>
                ) : (
                  word.text
                )}
              </Fragment>
            ))
          : passage.text}
      </p>
    </li>
  );
});

export function TranscriptReader({
  transcript,
  positionMs,
  onSeek,
}: {
  transcript: Transcript;
  positionMs: number;
  onSeek: (milliseconds: number) => void;
}) {
  const passages = useMemo(() => transcriptPassages(transcript.words), [transcript.words]);
  const currentWord = transcript.words.findLastIndex((word) => word.startMs <= positionMs);
  return (
    <ol aria-label="Timestamped passages" className="divide-y overflow-hidden rounded-xl border">
      {passages.map((passage) => {
        const offset = currentWord - passage.firstWord;
        return (
          <Passage
            key={passage.firstWord}
            passage={passage}
            currentWord={offset >= 0 && offset < passage.words.length ? offset : -1}
            onSeek={onSeek}
          />
        );
      })}
    </ol>
  );
}
