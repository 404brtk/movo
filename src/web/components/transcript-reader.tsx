import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, memo, useMemo, useState } from "react";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import {
  currentWordIndex,
  transcriptPassages,
  type TranscriptPassage,
} from "../../shared/transcript-passages.ts";
import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { PassageEditor } from "./passage-editor.tsx";
import { Button } from "./ui/button.tsx";

const revealPassage = (element: HTMLLIElement | null) =>
  element?.scrollIntoView({ block: "center" });
const focusElement = (element: HTMLElement | null) => element?.focus();

export interface TranscriptPlayback {
  positionMs: number;
  onSeek: (milliseconds: number) => void;
}

export interface TranscriptEditing {
  mediaId: string;
  revision: number;
}

interface EditedPassage {
  firstWord: number;
  open: boolean;
}

const Passage = memo(function Passage({
  passage,
  currentWord,
  revealed,
  onSeek,
  editing,
  edited,
  onEdited,
}: {
  passage: TranscriptPassage;
  currentWord: number;
  revealed: boolean;
  onSeek: ((milliseconds: number) => void) | undefined;
  editing: TranscriptEditing | undefined;
  edited: EditedPassage | undefined;
  onEdited: (edited: EditedPassage) => void;
}) {
  const current = currentWord >= 0;
  const time = formatDuration(passage.startMs / 1000);
  return (
    <li
      ref={revealed ? revealPassage : undefined}
      aria-current={current ? "time" : undefined}
      className={cn("flex gap-4 px-5 py-4 transition-colors sm:gap-6", current && "bg-muted")}
    >
      {onSeek ? (
        <button
          type="button"
          aria-label={`Go to ${time}`}
          className="min-h-10 shrink-0 self-start rounded-sm text-sm text-muted-foreground tabular-nums underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          onClick={() => onSeek(passage.startMs)}
        >
          {time}
        </button>
      ) : (
        <span className="shrink-0 py-2 text-sm text-muted-foreground tabular-nums">{time}</span>
      )}
      {editing && edited?.open ? (
        <PassageEditor
          mediaId={editing.mediaId}
          revision={editing.revision}
          passage={passage}
          onClose={() => onEdited({ firstWord: passage.firstWord, open: false })}
        />
      ) : (
        <p className="min-w-0 flex-1 py-2 text-sm leading-7 wrap-anywhere">
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
      )}
      {editing && !edited?.open ? (
        <Button
          ref={edited ? focusElement : undefined}
          variant="ghost"
          size="icon"
          aria-label={`Edit passage at ${time}`}
          className="size-10 shrink-0 self-start text-muted-foreground"
          onClick={() => onEdited({ firstWord: passage.firstWord, open: true })}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={18} aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
});

export function TranscriptReader({
  transcript,
  playback,
  revealMs,
  editing,
}: {
  transcript: Transcript;
  playback?: TranscriptPlayback | undefined;
  revealMs?: number | undefined;
  editing?: TranscriptEditing | undefined;
}) {
  const [edited, setEdited] = useState<EditedPassage | null>(null);
  const passages = useMemo(() => transcriptPassages(transcript.words), [transcript.words]);
  const currentWord = playback ? currentWordIndex(transcript.words, playback.positionMs) : -1;
  const revealedWord = revealMs === undefined ? -1 : currentWordIndex(transcript.words, revealMs);
  return (
    <ol aria-label="Timestamped passages" className="divide-y overflow-hidden rounded-xl border">
      {passages.map((passage) => {
        const offset = currentWord - passage.firstWord;
        return (
          <Passage
            key={passage.firstWord}
            passage={passage}
            currentWord={offset >= 0 && offset < passage.words.length ? offset : -1}
            revealed={
              revealedWord >= passage.firstWord &&
              revealedWord < passage.firstWord + passage.words.length
            }
            onSeek={playback?.onSeek}
            editing={editing}
            edited={edited?.firstWord === passage.firstWord ? edited : undefined}
            onEdited={setEdited}
          />
        );
      })}
    </ol>
  );
}
