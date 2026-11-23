import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { searchTerms } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { useMatchStepper, type StepDirection } from "../lib/match-stepper.ts";
import { useSearchDraft } from "../lib/search-draft.ts";
import { searchPassages, type TranscriptFound } from "../lib/transcript-search.ts";

export function useTranscriptSearch(transcript: Transcript, chosen: readonly number[] | undefined) {
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
      searchPassages(
        transcriptPassages(transcript.words),
        transcriptSpeakers(transcript),
        terms,
        chosen,
      ),
    [transcript, terms, chosen],
  );
  const order = useMemo(() => [...hits.keys()], [hits]);
  const stepper = useMatchStepper(order.length);
  const { index } = stepper;
  const revealAt = (position: number) => {
    const firstWord = order[position];
    setReveal(firstWord === undefined ? undefined : { firstWord });
  };
  const [revealed, setRevealed] = useState<{
    terms: readonly string[];
    chosen: readonly number[] | undefined;
  } | null>(null);
  if (revealed?.terms !== terms || revealed.chosen !== chosen) {
    const sameScope = revealed?.chosen === chosen;
    setRevealed({ terms, chosen });
    if (!sameScope) stepper.reset();
    revealAt(sameScope ? index : 0);
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
