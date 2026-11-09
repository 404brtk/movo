import { ArrowDown01Icon, ArrowUp01Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, memo, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import {
  currentWordIndex,
  transcriptPassages,
  type TranscriptPassage,
} from "../../shared/transcript-passages.ts";
import { formatDuration } from "../lib/format.ts";
import { marksByPassage, type PassageMark, type TranscriptMatches } from "../lib/passage-marks.ts";
import { pinnedHeight, useTranscriptFollow } from "../lib/transcript-follow.ts";
import { cn } from "../lib/utils.ts";
import { PassageEditor } from "./passage-editor.tsx";
import { Button } from "./ui/button.tsx";

const revealElement = (element: HTMLElement | null) => element?.scrollIntoView({ block: "center" });
const revealIfHidden = (element: HTMLElement | null) => {
  const bounds = element?.getBoundingClientRect();
  if (bounds && (bounds.top < pinnedHeight() || bounds.bottom > window.innerHeight - 120))
    element?.scrollIntoView({ block: "center" });
};
const focusElement = (element: HTMLElement | null) => element?.focus();

export interface TranscriptPlayback {
  positionMs: number;
  onSeek: (milliseconds: number) => void;
  mediaKind: MediaItem["kind"];
  following: boolean;
  onFollowingChange: (following: boolean) => void;
}

export interface TranscriptEditing {
  mediaId: string;
  revision: number;
}

interface EditedPassage {
  firstWord: number;
  open: boolean;
}

function MarkedWords({
  words,
  marks,
}: {
  words: TranscriptPassage["words"];
  marks: PassageMark[];
}) {
  return words.map((word, index) => {
    const mark = marks.find((entry) => index >= entry.start && index < entry.end);
    return (
      <Fragment key={index}>
        {index > 0 ? " " : null}
        {mark ? (
          <mark
            ref={mark.current && index === mark.start ? revealIfHidden : undefined}
            className={cn(
              "rounded-[3px] bg-highlight text-inherit shadow-[0_0_0_2px_var(--color-highlight)]",
              mark.current &&
                "bg-highlight-strong shadow-[0_0_0_2px_var(--color-highlight-strong),0_0_0_3.5px_var(--color-primary)]",
            )}
          >
            {word.text}
          </mark>
        ) : (
          word.text
        )}
      </Fragment>
    );
  });
}

const Passage = memo(function Passage({
  passage,
  currentWord,
  dimmed,
  revealed,
  marks,
  onSeek,
  editing,
  edited,
  onEdited,
}: {
  passage: TranscriptPassage;
  currentWord: number;
  dimmed: boolean;
  revealed: boolean;
  marks: PassageMark[] | undefined;
  onSeek: ((milliseconds: number) => void) | undefined;
  editing: TranscriptEditing | undefined;
  edited: EditedPassage | undefined;
  onEdited: (edited: EditedPassage) => void;
}) {
  const time = formatDuration(passage.startMs / 1000);
  const current = currentWord >= 0;
  const wordMarks =
    marks ?? (current ? [{ start: currentWord, end: currentWord + 1, current: false }] : undefined);
  const editorOpen = Boolean(editing && edited?.open);
  const timeClassName = cn(
    "mb-1 block text-xs/4 tabular-nums",
    current || editorOpen ? "font-medium text-primary-strong" : "text-muted-foreground",
  );
  return (
    <li
      ref={revealed ? revealElement : undefined}
      aria-current={current ? "time" : undefined}
      className={cn(
        "group/passage relative scroll-mt-14 py-3",
        editing && "-mx-3.5 rounded-xl px-3.5 transition-colors duration-150",
        editing && !editorOpen && "hover:bg-subtle has-focus-visible:bg-subtle",
        editorOpen && "my-1 rounded-[14px] bg-background pb-3.5 shadow-editor",
      )}
    >
      {onSeek && !editorOpen ? (
        <button
          type="button"
          aria-label={`Go to ${time}`}
          className={cn(
            timeClassName,
            "rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
          onClick={() => onSeek(passage.startMs)}
        >
          {time}
        </button>
      ) : (
        <span className={timeClassName}>{time}</span>
      )}
      {editing && edited?.open ? (
        <PassageEditor
          mediaId={editing.mediaId}
          revision={editing.revision}
          passage={passage}
          onClose={() => onEdited({ firstWord: passage.firstWord, open: false })}
        />
      ) : (
        <p
          className={cn(
            "text-[17px]/7 text-pretty wrap-anywhere transition-colors duration-200",
            dimmed && !current && "text-muted-foreground",
            editing && "pr-8 group-hover/passage:text-foreground",
          )}
        >
          {wordMarks ? <MarkedWords words={passage.words} marks={wordMarks} /> : passage.text}
        </p>
      )}
      {editing && !edited?.open ? (
        <Button
          ref={edited ? focusElement : undefined}
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit passage at ${time}`}
          className="absolute top-2 right-2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/passage:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          onClick={() => onEdited({ firstWord: passage.firstWord, open: true })}
        >
          <HugeiconsIcon icon={Edit02Icon} aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
});

const contains = (passage: TranscriptPassage, word: number) =>
  word >= passage.firstWord && word < passage.firstWord + passage.words.length;

export function TranscriptReader({
  transcript,
  playback,
  revealMs,
  editing,
  matches,
}: {
  transcript: Transcript;
  playback?: TranscriptPlayback | undefined;
  revealMs?: number | undefined;
  editing?: TranscriptEditing | undefined;
  matches?: TranscriptMatches | undefined;
}) {
  const [edited, setEdited] = useState<EditedPassage | null>(null);
  const passages = useMemo(() => transcriptPassages(transcript.words), [transcript.words]);
  const marks = useMemo(() => marksByPassage(passages, matches), [passages, matches]);
  const currentWord = playback ? currentWordIndex(transcript.words, playback.positionMs) : -1;
  const revealedWord = revealMs === undefined ? -1 : currentWordIndex(transcript.words, revealMs);
  const list = useRef<HTMLOListElement>(null);
  const currentPassage = passages.find((passage) => contains(passage, currentWord));
  const suspended = Boolean(matches) || Boolean(edited?.open);
  const { currentAbove } = useTranscriptFollow({
    list,
    passage: currentPassage?.firstWord,
    following: playback?.following ?? false,
    suspended,
    onFollowingChange: playback?.onFollowingChange,
  });
  return (
    <>
      <ol ref={list} aria-label="Timestamped passages" className="mt-2">
        {passages.map((passage) => (
          <Passage
            key={passage.firstWord}
            passage={passage}
            currentWord={contains(passage, currentWord) ? currentWord - passage.firstWord : -1}
            dimmed={(Boolean(playback) && !matches) || Boolean(edited?.open)}
            revealed={contains(passage, revealedWord)}
            marks={marks.get(passage.firstWord)}
            onSeek={playback?.onSeek}
            editing={editing}
            edited={edited?.firstWord === passage.firstWord ? edited : undefined}
            onEdited={setEdited}
          />
        ))}
      </ol>
      {playback && !playback.following && !suspended && currentPassage ? (
        <Button
          variant="ghost"
          className={cn(
            "fixed left-1/2 z-40 h-9 -translate-x-1/2 gap-2 rounded-full bg-background/82 pr-4 pl-3 text-foreground shadow-player backdrop-blur-[20px] backdrop-saturate-[1.8] hover:bg-background hover:text-foreground",
            playback.mediaKind === "audio" ? "bottom-24" : "bottom-6",
          )}
          onClick={() => playback.onFollowingChange(true)}
        >
          <HugeiconsIcon
            icon={currentAbove ? ArrowUp01Icon : ArrowDown01Icon}
            aria-hidden="true"
            className="text-primary-strong"
          />
          Back to current{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {formatDuration(currentPassage.startMs / 1000)}
          </span>
        </Button>
      ) : null}
    </>
  );
}
