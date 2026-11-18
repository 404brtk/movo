import { type ReactNode, type RefObject, useState } from "react";
import { Search01Icon, TextIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { maxSearchLength } from "../../shared/contracts/library.ts";
import { maxReplaceCharacters } from "../../shared/contracts/transcriptions.ts";
import { replaceInTranscript } from "../lib/api.ts";
import { matchCountLabel, type StepDirection, stepOnEnter } from "../lib/match-stepper.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { cn } from "../lib/utils.ts";
import type { FindAndReplaceState } from "./find-and-replace.tsx";
import { MatchStepper } from "./match-navigation.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { Spinner } from "./spinner.tsx";
import type { TranscriptSearchState } from "./transcript-search.tsx";
import { Button } from "./ui/button.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";

export type FindTool = "search" | "replace";

export const findBarSelector = "[data-find-bar]";

const tools = [
  ["search", "Search"],
  ["replace", "Replace"],
] as const;

const barLayouts = {
  searchOnly:
    "grid-cols-[minmax(0,1fr)_auto_auto] [grid-template-areas:'field_step_close'_'hint_hint_hint']",
  search:
    "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'mode_close'_'field_step'_'hint_hint'] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:[grid-template-areas:'field_step_mode_close'_'hint_hint_hint_hint']",
  replace:
    "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'mode_close'_'field_step'_'swap_act'_'hint_hint'] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:[grid-template-areas:'field_step_mode_close'_'swap_act_act_.'_'hint_hint_hint_hint']",
} as const;
const barClassName = "grid items-center gap-x-1.5 gap-y-2";
const fieldInputClassName =
  "pl-2.5 text-base md:text-sm [&::-webkit-search-cancel-button]:appearance-none";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "es"}`;

function FindField({
  icon,
  count,
  children,
}: {
  icon: IconSvgElement;
  count?: { id: string; label: string };
  children: ReactNode;
}) {
  return (
    <InputGroup className="h-9">
      <InputGroupAddon className="pr-1 pl-3">
        <HugeiconsIcon icon={icon} className="size-4" aria-hidden="true" />
      </InputGroupAddon>
      {children}
      {count ? (
        <InputGroupAddon align="inline-end" className="pr-2.5">
          <span id={count.id} className="text-[11.5px] text-muted-foreground tabular-nums">
            {count.label}
          </span>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

function BarControls({
  tool,
  canReplace,
  steppable,
  onStep,
  onToolChange,
  onClose,
}: {
  tool: FindTool;
  canReplace: boolean;
  steppable: boolean;
  onStep: (direction: StepDirection) => void;
  onToolChange: (tool: FindTool) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="[grid-area:step] max-sm:justify-self-end">
        <MatchStepper steppable={steppable} onStep={onStep} />
      </div>
      {canReplace ? (
        <SegmentedChoice
          label="Search or replace"
          options={tools}
          value={tool}
          onValueChange={onToolChange}
          className="[grid-area:mode]"
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2.5 justify-self-end [grid-area:close]"
        onClick={onClose}
      >
        Close
      </Button>
    </>
  );
}

function SearchBar({
  state,
  canReplace,
  fieldRef,
  onToolChange,
  onClose,
}: {
  state: TranscriptSearchState;
  canReplace: boolean;
  fieldRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: FindTool) => void;
  onClose: () => void;
}) {
  return (
    <search
      aria-label="Search this transcript"
      className={cn(barClassName, canReplace ? barLayouts.search : barLayouts.searchOnly)}
      data-find-bar=""
    >
      <div className="[grid-area:field]">
        <FindField
          icon={Search01Icon}
          count={{ id: "transcript-search-count", label: matchCountLabel(state) }}
        >
          <InputGroupInput
            ref={fieldRef}
            type="search"
            aria-label="Search this transcript"
            aria-describedby="transcript-search-count"
            maxLength={maxSearchLength}
            autoComplete="off"
            placeholder="Search words or speaker names"
            value={state.draft}
            className={fieldInputClassName}
            onChange={(event) => state.setDraft(event.currentTarget.value)}
            onKeyDown={stepOnEnter(state.step)}
          />
        </FindField>
      </div>
      <BarControls
        tool="search"
        canReplace={canReplace}
        steppable={state.count > 0}
        onStep={state.step}
        onToolChange={onToolChange}
        onClose={onClose}
      />
      <p className="text-xs text-pretty text-muted-foreground [grid-area:hint]">
        Finds passages with every word, in what was said or in the speaker’s name.
      </p>
    </search>
  );
}

function UndoFromHistory({ onOpenHistory }: { onOpenHistory: () => void }) {
  return (
    <>
      You can undo it from{" "}
      <button
        type="button"
        className="cursor-pointer rounded-sm text-foreground underline decoration-border-strong underline-offset-3 outline-none hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={onOpenHistory}
      >
        History
      </button>
      .
    </>
  );
}

function replaceHint(
  state: FindAndReplaceState,
  replaced: number | null,
  onOpenHistory: () => void,
): ReactNode {
  const searching = state.find.trim().length > 0;
  const undo = <UndoFromHistory onOpenHistory={onOpenHistory} />;
  if (replaced !== null)
    return (
      <>
        Replaced {plural(replaced, "match")}. {undo}
      </>
    );
  if (searching && state.count > 0 && state.changeCount === 0)
    return "Every match already reads like the replacement.";
  if (searching && state.count > 0)
    return (
      <>
        Matches whole words in {state.passageCount}{" "}
        {state.passageCount === 1 ? "passage" : "passages"}. {undo}
      </>
    );
  return "Matches whole words, ignoring case. Leave the replacement empty to remove them.";
}

function ReplaceBar({
  mediaId,
  revision,
  state,
  fieldRef,
  onToolChange,
  onOpenHistory,
  onClose,
}: {
  mediaId: string;
  revision: number;
  state: FindAndReplaceState;
  fieldRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: FindTool) => void;
  onOpenHistory: () => void;
  onClose: () => void;
}) {
  const [replaced, setReplaced] = useState<number | null>(null);
  const replace = useTranscriptChange(mediaId, () =>
    replaceInTranscript(mediaId, { revision, find: state.find, replacement: state.replacement }),
  );
  const searching = state.find.trim().length > 0;
  const ready = state.changeCount > 0 && state.previewCurrent && !replace.isPending;
  return (
    <form
      aria-label="Find and replace"
      className={cn(barClassName, barLayouts.replace)}
      data-find-bar=""
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        const count = state.changeCount;
        replace.mutate(undefined, { onSuccess: () => setReplaced(count) });
      }}
    >
      <div className="[grid-area:field]">
        <FindField
          icon={Search01Icon}
          count={{
            id: "transcript-find-count",
            label: matchCountLabel({ ...state, searching }),
          }}
        >
          <InputGroupInput
            ref={fieldRef}
            aria-label="Find"
            aria-describedby="transcript-find-count"
            maxLength={maxReplaceCharacters}
            autoComplete="off"
            placeholder="Find"
            value={state.find}
            disabled={replace.isPending}
            className={fieldInputClassName}
            onChange={(event) => {
              state.setFind(event.currentTarget.value);
              setReplaced(null);
            }}
            onKeyDown={stepOnEnter(state.step)}
          />
        </FindField>
      </div>
      <BarControls
        tool="replace"
        canReplace
        steppable={state.count > 0 && !replace.isPending}
        onStep={state.step}
        onToolChange={onToolChange}
        onClose={onClose}
      />
      <div className="[grid-area:swap]">
        <FindField icon={TextIcon}>
          <InputGroupInput
            aria-label="Replace with"
            maxLength={maxReplaceCharacters}
            autoComplete="off"
            placeholder="Replace with"
            value={state.replacement}
            disabled={replace.isPending}
            className={fieldInputClassName}
            onChange={(event) => {
              state.setReplacement(event.currentTarget.value);
              setReplaced(null);
            }}
          />
        </FindField>
      </div>
      <Button
        type="submit"
        size="lg"
        aria-busy={replace.isPending}
        disabled={!ready}
        className="justify-self-start [grid-area:act] max-sm:justify-self-end"
      >
        {replace.isPending ? <Spinner /> : null}
        {replace.isPending ? "Replacing…" : "Replace all"}
      </Button>
      <div className="grid gap-2 text-xs text-pretty [grid-area:hint]">
        {replace.isError ? (
          <p role="alert" className="wrap-anywhere text-destructive">
            {replace.error.message}
          </p>
        ) : null}
        <output aria-live="polite" className="text-muted-foreground">
          {replaceHint(state, replaced, onOpenHistory)}
        </output>
      </div>
    </form>
  );
}

export function TranscriptFindBar({
  tool,
  mediaId,
  revision,
  search,
  find,
  canReplace,
  fieldRef,
  onToolChange,
  onOpenHistory,
  onClose,
}: {
  tool: FindTool;
  mediaId: string;
  revision: number;
  search: TranscriptSearchState;
  find: FindAndReplaceState;
  canReplace: boolean;
  fieldRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: FindTool) => void;
  onOpenHistory: () => void;
  onClose: () => void;
}) {
  return tool === "replace" ? (
    <ReplaceBar
      mediaId={mediaId}
      revision={revision}
      state={find}
      fieldRef={fieldRef}
      onToolChange={onToolChange}
      onOpenHistory={onOpenHistory}
      onClose={onClose}
    />
  ) : (
    <SearchBar
      state={search}
      canReplace={canReplace}
      fieldRef={fieldRef}
      onToolChange={onToolChange}
      onClose={onClose}
    />
  );
}
