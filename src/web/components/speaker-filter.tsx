import { useCallback, useMemo } from "react";
import { ArrowDown01Icon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { speakerNames, speakersInOrder } from "../lib/speaker-filter.ts";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

const noWords: Transcript["words"] = [];

export function useSpeakerFilter(transcript: Transcript | null | undefined) {
  const requested = useSearch({ from: "/media/$mediaId", select: (search) => search.speakers });
  const requestedOnly = useSearch({ from: "/media/$mediaId", select: (search) => search.only });
  const navigate = useNavigate({ from: "/media/$mediaId" });
  const words = transcript?.words ?? noWords;
  const passages = useMemo(() => transcriptPassages(words), [words]);
  const choices = useMemo(() => {
    if (!transcript) return [];
    const speakers = transcriptSpeakers(transcript);
    return speakers.ids.length < 2
      ? []
      : speakersInOrder(passages).map((id) => ({ id, label: speakers.label(id) }));
  }, [transcript, passages]);
  const chosenChoices = useMemo(
    () => choices.filter(({ id }) => requested?.includes(id)),
    [choices, requested],
  );
  const chosen = useMemo(
    () => (chosenChoices.length === 0 ? undefined : chosenChoices.map(({ id }) => id)),
    [chosenChoices],
  );
  const only = chosen !== undefined && requestedOnly === true;
  const apply = useCallback(
    (speakers: readonly number[] | undefined, playOnly: boolean) =>
      void navigate({
        search: (previous) => ({
          ...previous,
          speakers: speakers?.length ? [...speakers] : undefined,
          only: speakers?.length && playOnly ? true : undefined,
        }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );
  const [single] = chosenChoices;
  const owner =
    single === undefined
      ? undefined
      : chosenChoices.length === 1
        ? `${single.label}'s`
        : `${chosenChoices.length} speakers'`;
  return {
    choices,
    chosen,
    only,
    passages,
    label:
      single === undefined
        ? "Speakers"
        : chosenChoices.length === 1
          ? single.label
          : `${chosenChoices.length} speakers`,
    owner,
    names: speakerNames(chosenChoices.map(({ label }) => label)),
    toggle: (speaker: number) =>
      apply(
        choices
          .filter(({ id }) => (id === speaker) !== Boolean(chosen?.includes(id)))
          .map(({ id }) => id),
        only,
      ),
    setOnly: (playOnly: boolean) => apply(chosen, playOnly),
    clear: () => apply(undefined, false),
  };
}

export type SpeakerFilter = ReturnType<typeof useSpeakerFilter>;

export function SpeakerFilterMenu({ filter }: { filter: SpeakerFilter }) {
  const { choices, chosen, only, label, toggle, setOnly, clear } = filter;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="toggle" size="sm" className="max-sm:w-7 max-sm:px-0" />}
        data-active={chosen === undefined ? undefined : ""}
      >
        <HugeiconsIcon icon={UserMultipleIcon} data-icon="inline-start" aria-hidden="true" />
        <span className="max-w-36 truncate max-sm:sr-only">{label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          aria-hidden="true"
          className="-mr-1 size-3.5 opacity-60 max-sm:hidden"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-72 min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show passages by</DropdownMenuLabel>
          {choices.map(({ id, label: speaker }) => (
            <DropdownMenuCheckboxItem
              key={id}
              checked={chosen?.includes(id) ?? false}
              onCheckedChange={() => toggle(id)}
            >
              <span className="truncate">{speaker}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuItem disabled={chosen === undefined} onClick={clear}>
            Show everyone
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuGroup className="mt-1.5">
          <DropdownMenuLabel>While playing</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={only}
            disabled={chosen === undefined}
            onCheckedChange={setOnly}
          >
            <span className="grid gap-0.5 py-0.5">
              Play only these speakers
              <span className="text-[11.5px] text-muted-foreground">Skips everyone else</span>
            </span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
