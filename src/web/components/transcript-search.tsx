import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { maxSearchLength } from "../../shared/contracts/library.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { searchTerms } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import {
  focusOnMount,
  matchCountLabel,
  stepOnEnter,
  useMatchStepper,
  type StepDirection,
} from "../lib/match-stepper.ts";
import { useSearchDraft } from "../lib/search-draft.ts";
import { searchPassages, type TranscriptFound } from "../lib/transcript-search.ts";
import { MatchStepper, PinnedBelowPlayer } from "./match-navigation.tsx";
import { Button } from "./ui/button.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";

export function useTranscriptSearch(transcript: Transcript) {
  const query = useSearch({ from: "/media/$mediaId", select: (search) => search.q });
  const navigate = useNavigate({ from: "/media/$mediaId" });
  const applyQuery = useCallback(
    (q: string | undefined) =>
      void navigate({
        search: (previous) => ({ ...previous, q }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );
  const [draft, setDraft] = useSearchDraft(query, applyQuery);
  const [reveal, setReveal] = useState<{ firstWord: number } | undefined>();
  const previewDraft = useDeferredValue(draft);
  const terms = useMemo(() => searchTerms(previewDraft), [previewDraft]);
  const hits = useMemo(
    () =>
      searchPassages(transcriptPassages(transcript.words), transcriptSpeakers(transcript), terms),
    [transcript, terms],
  );
  const order = useMemo(() => [...hits.keys()], [hits]);
  const stepper = useMatchStepper(order.length);
  const { index } = stepper;
  const revealAt = (position: number) => {
    const firstWord = order[position];
    setReveal(firstWord === undefined ? undefined : { firstWord });
  };
  const [revealedTerms, setRevealedTerms] = useState<readonly string[] | null>(null);
  if (terms !== revealedTerms) {
    setRevealedTerms(terms);
    revealAt(index);
  }
  const currentPassage = order[index];
  const found = useMemo<TranscriptFound | undefined>(
    () => (terms.length === 0 ? undefined : { hits, current: currentPassage, reveal }),
    [terms, hits, currentPassage, reveal],
  );
  return {
    query,
    draft,
    searching: terms.length > 0,
    previewCurrent: previewDraft === draft,
    count: order.length,
    index,
    found,
    setDraft: (value: string) => {
      setDraft(value);
      stepper.reset();
    },
    step: (direction: StepDirection) => revealAt(stepper.step(direction)),
    clear: () => {
      setDraft("");
      stepper.reset();
      applyQuery(undefined);
    },
  };
}

export type TranscriptSearchState = ReturnType<typeof useTranscriptSearch>;

export function TranscriptSearch({
  state,
  onClose,
}: {
  state: TranscriptSearchState;
  onClose: () => void;
}) {
  return (
    <PinnedBelowPlayer>
      <search
        aria-label="Search this transcript"
        className="grid gap-2 rounded-xl bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-border)]"
      >
        <div className="flex items-center gap-2">
          <InputGroup className="flex-1 bg-background">
            <InputGroupAddon className="pr-1 pl-3">
              <HugeiconsIcon icon={Search01Icon} className="size-4" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={focusOnMount}
              type="search"
              aria-label="Search this transcript"
              aria-describedby="transcript-search-count"
              maxLength={maxSearchLength}
              autoComplete="off"
              placeholder="Search words or speaker names"
              value={state.draft}
              className="pl-2.5 text-base md:text-sm [&::-webkit-search-cancel-button]:appearance-none"
              onChange={(event) => state.setDraft(event.currentTarget.value)}
              onKeyDown={stepOnEnter(state.step)}
            />
            <InputGroupAddon align="inline-end" className="pr-2.5">
              <span
                id="transcript-search-count"
                className="text-[11.5px] text-muted-foreground tabular-nums"
              >
                {matchCountLabel(state)}
              </span>
            </InputGroupAddon>
          </InputGroup>
          <MatchStepper steppable={state.count > 0} onStep={state.step} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <p className="text-pretty">
            Finds passages with every word, in what was said or in the speaker’s name.
          </p>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </search>
    </PinnedBelowPlayer>
  );
}
