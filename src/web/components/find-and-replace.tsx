import { useDeferredValue, useMemo, useState } from "react";
import { maxReplaceCharacters, type Transcript } from "../../shared/contracts/transcriptions.ts";
import { findWords, replaceWords } from "../../shared/transcript-edits.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { replaceInTranscript } from "../lib/api.ts";
import {
  focusOnMount,
  matchCountLabel,
  stepOnEnter,
  useMatchStepper,
  type StepDirection,
} from "../lib/match-stepper.ts";
import { marksByPassage, type TranscriptMatches } from "../lib/passage-marks.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { MatchStepper, PinnedBelowPlayer } from "./match-navigation.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "es"}`;

export function useFindAndReplace(transcript: Transcript) {
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const previewFind = useDeferredValue(find);
  const previewReplacement = useDeferredValue(replacement);
  const found = useMemo(
    () => findWords(transcript.words, previewFind),
    [transcript.words, previewFind],
  );
  const changeCount = useMemo(
    () => replaceWords(transcript.words, previewFind, previewReplacement).length,
    [transcript.words, previewFind, previewReplacement],
  );
  const passageCount = useMemo(
    () => marksByPassage(transcriptPassages(transcript.words), { ranges: found, current: 0 }).size,
    [found, transcript.words],
  );
  const stepper = useMatchStepper(found.length);
  const { index } = stepper;
  const matches = useMemo<TranscriptMatches | undefined>(
    () => (found.length === 0 ? undefined : { ranges: found, current: index }),
    [found, index],
  );
  return {
    find,
    replacement,
    count: found.length,
    changeCount,
    passageCount,
    index,
    matches,
    previewCurrent: previewFind === find && previewReplacement === replacement,
    setFind: (value: string) => {
      setFind(value);
      stepper.reset();
    },
    setReplacement,
    step: (direction: StepDirection) => {
      stepper.step(direction);
    },
  };
}

export type FindAndReplaceState = ReturnType<typeof useFindAndReplace>;

export function FindAndReplace({
  mediaId,
  revision,
  state,
  onClose,
}: {
  mediaId: string;
  revision: number;
  state: FindAndReplaceState;
  onClose: () => void;
}) {
  const [replaced, setReplaced] = useState<number | null>(null);
  const replace = useTranscriptChange(mediaId, () =>
    replaceInTranscript(mediaId, { revision, find: state.find, replacement: state.replacement }),
  );
  const searching = state.find.trim().length > 0;
  const ready = state.changeCount > 0 && state.previewCurrent && !replace.isPending;
  const steppable = state.count > 0 && !replace.isPending;
  return (
    <PinnedBelowPlayer>
      <form
        aria-label="Find and replace"
        className="grid gap-2 rounded-xl bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-border)] sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const count = state.changeCount;
          replace.mutate(undefined, { onSuccess: () => setReplaced(count) });
        }}
      >
        <div className="flex items-center gap-2">
          <label htmlFor="transcript-find" className="sr-only">
            Find
          </label>
          <div className="relative flex-1">
            <Input
              ref={focusOnMount}
              id="transcript-find"
              placeholder="Find"
              maxLength={maxReplaceCharacters}
              value={state.find}
              disabled={replace.isPending}
              aria-describedby="transcript-find-count"
              className="pr-16"
              onChange={(event) => {
                state.setFind(event.target.value);
                setReplaced(null);
              }}
              onKeyDown={stepOnEnter(state.step)}
            />
            <span
              id="transcript-find-count"
              className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11.5px] text-muted-foreground tabular-nums"
            >
              {matchCountLabel({ ...state, searching })}
            </span>
          </div>
          <MatchStepper steppable={steppable} onStep={state.step} />
        </div>
        <div className="flex items-center gap-2 sm:contents">
          <label htmlFor="transcript-replacement" className="sr-only">
            Replace with
          </label>
          <Input
            id="transcript-replacement"
            placeholder="Replace with"
            maxLength={maxReplaceCharacters}
            value={state.replacement}
            disabled={replace.isPending}
            onChange={(event) => {
              state.setReplacement(event.target.value);
              setReplaced(null);
            }}
          />
          <Button type="submit" aria-busy={replace.isPending} disabled={!ready}>
            {replace.isPending ? <Spinner /> : null}
            {replace.isPending ? "Replacing…" : "Replace all"}
          </Button>
        </div>
        {replace.isError ? (
          <p role="alert" className="text-xs wrap-anywhere text-destructive sm:col-span-full">
            {replace.error.message}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:col-span-full">
          <output aria-live="polite" className="text-pretty">
            {replaced !== null
              ? `Replaced ${plural(replaced, "match")}. You can undo it from History.`
              : searching && state.count > 0 && state.changeCount === 0
                ? "Every match already reads like the replacement."
                : searching && state.count > 0
                  ? `Matches whole words in ${state.passageCount} ${state.passageCount === 1 ? "passage" : "passages"}. You can undo it from History.`
                  : "Matches whole words, ignoring case. Leave the replacement empty to remove them."}
          </output>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </PinnedBelowPlayer>
  );
}
