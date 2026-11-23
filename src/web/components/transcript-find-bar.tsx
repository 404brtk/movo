import type { ReactNode, RefObject } from "react";
import { Search01Icon, TextIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { maxSearchLength } from "../../shared/contracts/library.ts";
import { maxReplaceCharacters } from "../../shared/contracts/transcriptions.ts";
import { matchCountLabel, type StepDirection, stepOnEnter } from "../lib/match-stepper.ts";
import type { ReplaceAll } from "../lib/replace-all.ts";
import { cn } from "../lib/utils.ts";
import type { FindAndReplaceState } from "./find-and-replace.tsx";
import { MatchStepper } from "./match-navigation.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { Spinner } from "./spinner.tsx";
import type { SpeakerFilter } from "./speaker-filter.tsx";
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
  searchOnly: "grid-cols-[minmax(0,1fr)_auto_auto] [grid-template-areas:'field_step_close']",
  search:
    "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'mode_close'_'field_step'] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:[grid-template-areas:'field_step_mode_close']",
  replace:
    "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'mode_close'_'field_step'_'swap_act'] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:[grid-template-areas:'field_step_mode_close'_'swap_act_act_.']",
} as const;
const barClassName = "grid grid-cols-1 gap-y-2";
const controlsClassName = "grid items-center gap-x-1.5 gap-y-2";
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
  filter,
  canReplace,
  fieldRef,
  onToolChange,
  onClose,
}: {
  state: TranscriptSearchState;
  filter: SpeakerFilter;
  canReplace: boolean;
  fieldRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: FindTool) => void;
  onClose: () => void;
}) {
  return (
    <search aria-label="Search this transcript" className={barClassName} data-find-bar="">
      <div
        className={cn(controlsClassName, canReplace ? barLayouts.search : barLayouts.searchOnly)}
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
              placeholder={
                filter.owner === undefined
                  ? "Search words or speaker names"
                  : `Search ${filter.owner} passages`
              }
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
      </div>
    </search>
  );
}

function ReplaceBar({
  revision,
  replace,
  state,
  filter,
  fieldRef,
  onToolChange,
  onClose,
}: {
  revision: number;
  replace: ReplaceAll;
  state: FindAndReplaceState;
  filter: SpeakerFilter;
  fieldRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: FindTool) => void;
  onClose: () => void;
}) {
  const searching = state.find.trim().length > 0;
  const ready = state.changeCount > 0 && state.previewCurrent && !replace.pending;
  return (
    <form
      aria-label="Find and replace"
      className={barClassName}
      data-find-bar=""
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        replace.replaceAll(
          {
            revision,
            find: state.find,
            replacement: state.replacement,
            ...(state.chosen === undefined ? {} : { speakers: state.chosen }),
          },
          {
            title: `Replaced ${plural(state.changeCount, "match")}`,
            ...(filter.owner === undefined
              ? {}
              : { description: `In passages by ${filter.names}` }),
          },
        );
      }}
    >
      <div className={cn(controlsClassName, barLayouts.replace)}>
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
              placeholder={filter.owner === undefined ? "Find" : `Find in ${filter.owner} passages`}
              value={state.find}
              disabled={replace.pending}
              className={fieldInputClassName}
              onChange={(event) => state.setFind(event.currentTarget.value)}
              onKeyDown={stepOnEnter(state.step)}
            />
          </FindField>
        </div>
        <BarControls
          tool="replace"
          canReplace
          steppable={state.count > 0 && !replace.pending}
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
              disabled={replace.pending}
              className={fieldInputClassName}
              onChange={(event) => state.setReplacement(event.currentTarget.value)}
            />
          </FindField>
        </div>
        <Button
          type="submit"
          size="lg"
          aria-busy={replace.pending}
          disabled={!ready}
          className="justify-self-start [grid-area:act] max-sm:justify-self-end"
        >
          {replace.pending ? <Spinner /> : null}
          {replace.pending ? "Replacing…" : "Replace all"}
        </Button>
      </div>
      {replace.error ? (
        <p role="alert" className="text-xs text-pretty wrap-anywhere text-destructive">
          {replace.error.message}
        </p>
      ) : null}
    </form>
  );
}

export function TranscriptFindBar({
  tool,
  replace,
  revision,
  search,
  find,
  filter,
  canReplace,
  fieldRef,
  onToolChange,
  onClose,
}: {
  tool: FindTool;
  replace: ReplaceAll;
  revision: number;
  search: TranscriptSearchState;
  find: FindAndReplaceState;
  filter: SpeakerFilter;
  canReplace: boolean;
  fieldRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: FindTool) => void;
  onClose: () => void;
}) {
  return tool === "replace" ? (
    <ReplaceBar
      replace={replace}
      revision={revision}
      state={find}
      filter={filter}
      fieldRef={fieldRef}
      onToolChange={onToolChange}
      onClose={onClose}
    />
  ) : (
    <SearchBar
      state={search}
      filter={filter}
      canReplace={canReplace}
      fieldRef={fieldRef}
      onToolChange={onToolChange}
      onClose={onClose}
    />
  );
}
