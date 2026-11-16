import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ArrowDown01Icon, ArrowUp01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { maxSearchLength } from "../../shared/contracts/library.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { searchTerms } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { useSearchDraft } from "../lib/search-draft.ts";
import { pinHeight } from "../lib/transcript-follow.ts";
import { searchPassages, type TranscriptFound } from "../lib/transcript-search.ts";
import { Button } from "./ui/button.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";

const focusOnMount = (input: HTMLInputElement | null) => input?.focus();
const pinBelowPlayer = pinHeight("--pinned-find");

export function useTranscriptSearch(transcript: Transcript) {
  const query = useSearch({ from: "/media/$mediaId", select: (search) => search.q });
  const navigate = useNavigate({ from: "/media/$mediaId" });
  const applyQuery = useCallback(
    (q: string | undefined) =>
      void navigate({ search: (previous) => ({ ...previous, q }), replace: true }),
    [navigate],
  );
  const [draft, setDraft] = useSearchDraft(query, applyQuery);
  const [current, setCurrent] = useState(0);
  const previewDraft = useDeferredValue(draft);
  const terms = useMemo(() => searchTerms(previewDraft), [previewDraft]);
  const hits = useMemo(
    () =>
      searchPassages(transcriptPassages(transcript.words), transcriptSpeakers(transcript), terms),
    [transcript, terms],
  );
  const order = useMemo(() => [...hits.keys()], [hits]);
  const index = order.length === 0 ? 0 : Math.min(current, order.length - 1);
  const found = useMemo<TranscriptFound | undefined>(
    () => (terms.length === 0 ? undefined : { hits, current: order[index] }),
    [terms, hits, order, index],
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
      setCurrent(0);
    },
    step: (direction: 1 | -1) =>
      setCurrent((order.length + index + direction) % Math.max(order.length, 1)),
    clear: () => {
      setDraft("");
      setCurrent(0);
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
  const steppable = state.count > 0;
  return (
    <div
      ref={pinBelowPlayer}
      className="sticky top-[var(--pinned-player,0px)] z-30 bg-background pt-3 pb-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent"
    >
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
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                state.step(event.shiftKey ? -1 : 1);
              }}
            />
            <InputGroupAddon align="inline-end" className="pr-2.5">
              <span
                id="transcript-search-count"
                className="text-[11.5px] text-muted-foreground tabular-nums"
              >
                {state.searching && state.previewCurrent
                  ? state.count > 0
                    ? `${state.index + 1} of ${state.count}`
                    : "No matches"
                  : ""}
              </span>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous match"
              disabled={!steppable}
              onClick={() => state.step(-1)}
            >
              <HugeiconsIcon icon={ArrowUp01Icon} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next match"
              disabled={!steppable}
              onClick={() => state.step(1)}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden="true" />
            </Button>
          </div>
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
    </div>
  );
}
