import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { formatMoment, type ChapterRange } from "../../shared/chapters.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import {
  currentWordIndex,
  transcriptPassages,
  type TranscriptPassage,
} from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { formatDuration } from "../lib/format.ts";
import { focusOnMount } from "../lib/match-stepper.ts";
import { marksByPassage, type PassageMark, type TranscriptMatches } from "../lib/passage-marks.ts";
import { transcriptRows } from "../lib/speaker-filter.ts";
import { pinnedHeight, useTranscriptFollow } from "../lib/transcript-follow.ts";
import type { PassageHit, TranscriptFound } from "../lib/transcript-search.ts";
import { cn } from "../lib/utils.ts";
import { HighlightedText } from "./highlighted-text.tsx";
import { PassageEditor } from "./passage-editor.tsx";
import { PassageSpeakerMenu, SpeakerHeading, type SpeakerEditing } from "./speaker-controls.tsx";
import { Button } from "./ui/button.tsx";

const revealElement = (element: HTMLElement | null) => element?.scrollIntoView({ block: "center" });
const revealIfHidden = (element: Element | null | undefined) => {
  const bounds = element?.getBoundingClientRect();
  if (bounds && (bounds.top < pinnedHeight() || bounds.bottom > window.innerHeight - 120))
    element?.scrollIntoView({ block: "center" });
};
const revealOnHover =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/passage:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:data-popup-open:opacity-100";

export interface TranscriptPlayback {
  positionMs: number;
  onSeek: (milliseconds: number) => void;
  floatingPlayer: boolean;
  following: boolean;
  jumps: number;
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
  scrollsIntoView,
  marks,
  onSeek,
  editing,
  edited,
  onEdited,
  speakerHeading,
  speakerEditing,
  speakerSpacing,
  hit,
  searchCurrent,
  markCurrentWord,
}: {
  passage: TranscriptPassage;
  currentWord: number;
  dimmed: boolean;
  revealed: boolean;
  scrollsIntoView: boolean;
  marks: PassageMark[] | undefined;
  onSeek: ((milliseconds: number) => void) | undefined;
  editing: TranscriptEditing | undefined;
  edited: EditedPassage | undefined;
  onEdited: (edited: EditedPassage) => void;
  speakerHeading: string | null;
  speakerEditing: SpeakerEditing | undefined;
  speakerSpacing: "turn" | "continued" | undefined;
  hit: PassageHit | undefined;
  searchCurrent: boolean;
  markCurrentWord: boolean;
}) {
  const time = formatDuration(passage.startMs / 1000);
  const current = currentWord >= 0;
  const wordMarks =
    marks ??
    hit?.marks ??
    (current && markCurrentWord
      ? [{ start: currentWord, end: currentWord + 1, current: false }]
      : undefined);
  const speakerNote = speakerHeading === null ? hit?.speaker : undefined;
  const editorOpen = Boolean(editing && edited?.open);
  const timeClassName = cn(
    "mb-1 block text-xs/4 tabular-nums",
    current || editorOpen ? "font-medium text-primary-strong" : "text-muted-foreground",
  );
  return (
    <li
      ref={revealed && scrollsIntoView ? revealElement : undefined}
      aria-current={current ? "time" : undefined}
      data-start-ms={passage.startMs}
      data-first-word={passage.firstWord}
      className={cn(
        "group/passage relative scroll-mt-14 py-3",
        revealed &&
          (current || !onSeek) &&
          !editorOpen &&
          "ask-washed -mx-3.5 rounded-xl bg-tint px-3.5",
        editing && "-mx-3.5 rounded-xl px-3.5 transition-colors duration-150",
        editing && !editorOpen && "hover:bg-subtle has-focus-visible:bg-subtle",
        editorOpen && "my-1 rounded-[14px] bg-background pb-3.5 shadow-editor",
        speakerSpacing === "turn" && "mt-4",
        speakerSpacing === "continued" && !editorOpen && "py-2",
        searchCurrent && !editorOpen && "-mx-3.5 rounded-xl bg-tint px-3.5",
      )}
    >
      {speakerHeading !== null && passage.speaker !== undefined ? (
        <SpeakerHeading
          speaker={passage.speaker}
          editing={speakerEditing}
          label={speakerHeading}
          ranges={hit?.speaker?.ranges}
        />
      ) : null}
      <div className={cn(speakerNote && "flex items-baseline gap-1.5")}>
        {onSeek && !editorOpen ? (
          <button
            type="button"
            aria-label={`Go to ${time}`}
            className={cn(
              timeClassName,
              "cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
            onClick={() => onSeek(passage.startMs)}
          >
            {time}
          </button>
        ) : (
          <span className={timeClassName}>{time}</span>
        )}
        {speakerNote ? (
          <span className="text-xs/4 font-medium">
            <span aria-hidden="true" className="text-muted-foreground">
              ·{" "}
            </span>
            <HighlightedText text={speakerNote.name} ranges={speakerNote.ranges} />
          </span>
        ) : null}
      </div>
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
            editing && "group-hover/passage:text-foreground",
            editing && (speakerEditing ? "pr-16" : "pr-8"),
          )}
        >
          {wordMarks ? <MarkedWords words={passage.words} marks={wordMarks} /> : passage.text}
        </p>
      )}
      {speakerEditing && !edited?.open ? (
        <PassageSpeakerMenu
          editing={speakerEditing}
          passage={passage}
          className={cn(
            "absolute right-10",
            speakerHeading === null ? "top-2" : "top-9",
            revealOnHover,
          )}
        />
      ) : null}
      {editing && !edited?.open ? (
        <Button
          ref={edited ? focusOnMount : undefined}
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit passage at ${time}`}
          className={cn(
            "absolute right-2",
            speakerHeading === null ? "top-2" : "top-9",
            revealOnHover,
          )}
          onClick={() => onEdited({ firstWord: passage.firstWord, open: true })}
        >
          <HugeiconsIcon icon={Edit02Icon} aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
});

function FoldRow({
  label,
  passages,
  expanded,
  locked,
  playing,
  skipping,
  spacing,
  onToggle,
}: {
  label: string;
  passages: readonly TranscriptPassage[];
  expanded: boolean;
  locked: boolean;
  playing: boolean;
  skipping: boolean;
  spacing: "turn" | "stacked" | undefined;
  onToggle: () => void;
}) {
  const startMs = passages[0]?.startMs ?? 0;
  const endMs = Math.max(startMs, ...passages.map((passage) => passage.endMs));
  const count = `${passages.length} ${passages.length === 1 ? "passage" : "passages"}`;
  return (
    <li
      aria-current={playing ? "time" : undefined}
      className={cn(
        "scroll-mt-14",
        spacing === "turn" && "mt-4",
        spacing === "stacked" && "mt-1.5",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        disabled={locked}
        className={cn(
          "-mx-3.5 flex h-9 w-[calc(100%+1.75rem)] cursor-pointer items-center gap-2 rounded-xl px-3.5 text-left text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45",
          expanded
            ? "text-muted-foreground hover:bg-subtle hover:text-foreground"
            : playing
              ? "bg-tint text-foreground"
              : "bg-subtle text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        onClick={onToggle}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          aria-hidden="true"
          className={cn(
            "size-3.5 transition-transform duration-150 ease-snappy motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 truncate">
          {expanded ? `Hide ${label}` : `${label} · ${count}`}
        </span>
        {playing ? (
          <span className="flex shrink-0 items-center gap-1.5 text-primary-strong">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            Current
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
          {skipping && !expanded ? (
            <span className="max-sm:hidden">Skipped while playing · </span>
          ) : null}
          {formatDuration(startMs / 1000)}–{formatDuration(endMs / 1000)}
        </span>
      </button>
    </li>
  );
}

function ChapterHeading({ range }: { range: ChapterRange }) {
  return (
    <li className="mt-6 mb-0.5 scroll-mt-14">
      <p className="text-xs/4 text-muted-foreground tabular-nums">
        {formatMoment(range.startMs)}–{formatMoment(range.endMs)}
      </p>
      <h3 className="mt-0.5 text-[19px]/[26px] font-semibold tracking-[-0.015em] text-balance wrap-anywhere">
        {range.chapter.title}
      </h3>
    </li>
  );
}

const contains = (passage: TranscriptPassage, word: number) =>
  word >= passage.firstWord && word < passage.firstWord + passage.words.length;

export function TranscriptReader({
  transcript,
  playback,
  revealMs,
  editing,
  searching = false,
  chosenSpeakers,
  skipping = false,
  matches,
  found,
  chapters = [],
}: {
  chapters?: readonly ChapterRange[] | undefined;
  transcript: Transcript;
  playback?: TranscriptPlayback | undefined;
  revealMs?: number | undefined;
  editing?: TranscriptEditing | undefined;
  searching?: boolean;
  chosenSpeakers?: readonly number[] | undefined;
  skipping?: boolean;
  matches?: TranscriptMatches | undefined;
  found?: TranscriptFound | undefined;
}) {
  const [edited, setEdited] = useState<EditedPassage | null>(null);
  const [openingMs, setOpeningMs] = useState(revealMs);
  if (openingMs !== undefined && openingMs !== revealMs) setOpeningMs(undefined);
  const passages = useMemo(() => transcriptPassages(transcript.words), [transcript.words]);
  const speakers = useMemo(() => transcriptSpeakers(transcript), [transcript]);
  const speakerEditing = useMemo(
    () =>
      editing && speakers.ids.length > 0
        ? { mediaId: editing.mediaId, revision: editing.revision, speakers }
        : undefined,
    [editing, speakers],
  );
  const marks = useMemo(() => marksByPassage(passages, matches), [passages, matches]);
  const currentWord = playback ? currentWordIndex(transcript.words, playback.positionMs) : -1;
  const revealedWord = revealMs === undefined ? -1 : currentWordIndex(transcript.words, revealMs);
  const list = useRef<HTMLOListElement>(null);
  const currentIndex = passages.findIndex((passage) => contains(passage, currentWord));
  const currentPassage = passages[currentIndex];
  const rows = useMemo(() => transcriptRows(passages, chosenSpeakers), [passages, chosenSpeakers]);
  const headings = useMemo(() => {
    const byPassage = new Map<number, ChapterRange[]>();
    for (const range of chapters) {
      const passage = passages.findIndex((entry) => entry.startMs >= range.startMs);
      if (passage >= 0) byPassage.set(passage, [...(byPassage.get(passage) ?? []), range]);
    }
    return byPassage;
  }, [chapters, passages]);
  const chapterHeadings = (start: number, end = start + 1) =>
    passages
      .slice(start, end)
      .flatMap((_, offset) => headings.get(start + offset) ?? [])
      .map((range) => <ChapterHeading key={`chapter-${range.chapter.id}`} range={range} />);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const toggleFold = (firstWord: number) => {
    const next = new Set(expanded);
    if (!next.delete(firstWord)) next.add(firstWord);
    setExpanded(next);
  };
  const revealJumps = playback?.jumps ?? 0;
  const [seenReveal, setSeenReveal] = useState<{ ms: number | undefined; jumps: number }>();
  if (seenReveal === undefined || seenReveal.ms !== revealMs || seenReveal.jumps !== revealJumps) {
    setSeenReveal({ ms: revealMs, jumps: revealJumps });
    const revealedIndex = passages.findIndex((passage) => contains(passage, revealedWord));
    const revealedFold = rows.find(
      (row) => row.kind === "fold" && row.start <= revealedIndex && revealedIndex < row.end,
    );
    const foldWord =
      revealedFold?.kind === "fold" ? passages[revealedFold.start]?.firstWord : undefined;
    if (foldWord !== undefined && !expanded.has(foldWord))
      setExpanded(new Set(expanded).add(foldWord));
  }
  const openingWord = currentWordIndex(transcript.words, revealMs ?? 0);
  const openingPassage = passages.find((passage) => contains(passage, openingWord));
  const suspended = searching || Boolean(edited?.open);
  const reveal = found?.reveal;
  useEffect(() => {
    if (!reveal) return undefined;
    const frame = requestAnimationFrame(() =>
      revealIfHidden(list.current?.querySelector(`[data-first-word="${reveal.firstWord}"]`)),
    );
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  const { currentAbove } = useTranscriptFollow({
    list,
    passage: currentPassage?.firstWord,
    openingPassage: openingPassage?.firstWord,
    following: playback?.following ?? false,
    jumps: playback?.jumps ?? 0,
    suspended,
    onFollowingChange: playback?.onFollowingChange,
  });
  const passageAt = (index: number, afterHeading: boolean) => {
    const passage = passages[index];
    if (!passage) return null;
    const previousSpeaker = passages[index - 1]?.speaker;
    return (
      <Passage
        key={passage.firstWord}
        passage={passage}
        currentWord={contains(passage, currentWord) ? currentWord - passage.firstWord : -1}
        dimmed={(Boolean(playback) && !matches && !found) || Boolean(edited?.open)}
        revealed={contains(passage, revealedWord)}
        scrollsIntoView={!playback || revealMs === openingMs}
        marks={marks.get(passage.firstWord)}
        onSeek={playback?.onSeek}
        editing={editing}
        edited={edited?.firstWord === passage.firstWord ? edited : undefined}
        onEdited={setEdited}
        speakerHeading={
          passage.speaker !== undefined && previousSpeaker !== passage.speaker
            ? speakers.label(passage.speaker)
            : null
        }
        speakerEditing={speakerEditing}
        speakerSpacing={
          speakers.ids.length < 2
            ? undefined
            : previousSpeaker === passage.speaker
              ? "continued"
              : index > 0 && !afterHeading
                ? "turn"
                : undefined
        }
        hit={found?.hits.get(passage.firstWord)}
        searchCurrent={found?.current === passage.firstWord}
        markCurrentWord={!searching}
      />
    );
  };
  const editingIndex = edited?.open
    ? passages.findIndex((passage) => passage.firstWord === edited.firstWord)
    : -1;
  const holdsEditor = ({ start, end }: { start: number; end: number }) =>
    start <= editingIndex && editingIndex < end;
  const foldOpen = (row: { start: number; end: number }) =>
    holdsEditor(row) || expanded.has(passages[row.start]?.firstWord ?? row.start);
  return (
    <>
      <ol ref={list} aria-label="Timestamped passages">
        {rows.flatMap((row, rowIndex) => {
          if (row.kind === "passage")
            return [...chapterHeadings(row.index), passageAt(row.index, headings.has(row.index))];
          const folded = passages.slice(row.start, row.end);
          const firstWord = folded[0]?.firstWord ?? row.start;
          const open = foldOpen(row);
          const previous = rows[rowIndex - 1];
          return [
            ...(open ? chapterHeadings(row.start) : chapterHeadings(row.start, row.end)),
            <FoldRow
              key={`fold-${firstWord}`}
              label={row.speaker === undefined ? "No speaker" : speakers.label(row.speaker)}
              passages={folded}
              expanded={open}
              locked={holdsEditor(row)}
              playing={!open && currentIndex >= row.start && currentIndex < row.end}
              skipping={skipping}
              spacing={
                previous === undefined
                  ? undefined
                  : previous.kind === "fold" && !foldOpen(previous)
                    ? "stacked"
                    : "turn"
              }
              onToggle={() => toggleFold(firstWord)}
            />,
            ...(open
              ? folded.flatMap((_, offset) => {
                  const index = row.start + offset;
                  if (offset === 0) return [passageAt(index, true)];
                  return [...chapterHeadings(index), passageAt(index, headings.has(index))];
                })
              : []),
          ];
        })}
      </ol>
      {playback && !playback.following && !suspended && currentPassage ? (
        <Button
          variant="ghost"
          className={cn(
            "sticky z-30 mx-auto mt-4 flex h-9 w-fit gap-2 rounded-full bg-background/82 pr-4 pl-3 text-foreground shadow-player backdrop-blur-[20px] backdrop-saturate-[1.8] hover:bg-background hover:text-foreground",
            playback.floatingPlayer ? "bottom-24" : "bottom-6",
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
