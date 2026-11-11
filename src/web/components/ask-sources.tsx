import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { citedMoments, type MomentIndex } from "../../shared/citations.ts";
import type { ChatPart } from "../../shared/contracts/ask.ts";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import { matchedRanges, searchTerms } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptionOptions } from "../lib/api.ts";
import { formatDay, formatDuration } from "../lib/format.ts";
import { useMomentNavigation } from "../lib/moment-link.ts";
import { HighlightedText } from "./highlighted-text.tsx";
import { MediaRow } from "./media-row.tsx";

function searchedWords(parts: readonly ChatPart[]) {
  const queries = parts.flatMap((part) => {
    if (part.type !== "tool" || part.toolName !== "search_library") return [];
    const query =
      typeof part.input === "object" && part.input !== null ? Reflect.get(part.input, "q") : "";
    return typeof query === "string" ? [query] : [];
  });
  return searchTerms(queries.join(" "));
}

function QuotedMoment({
  mediaId,
  startMs,
  text,
  terms,
}: {
  mediaId: string;
  startMs: number;
  text: string;
  terms: readonly string[];
}) {
  return (
    <li className="relative col-span-2 grid grid-cols-subgrid rounded-lg px-2.5 py-2 text-[13.5px]/[21px] hover:bg-subtle has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50">
      <Link
        to="/media/$mediaId"
        params={{ mediaId }}
        search={{ startMs }}
        {...useMomentNavigation(mediaId, startMs)}
        className="font-medium text-primary-strong tabular-nums outline-none after:absolute after:inset-0 after:rounded-lg"
      >
        {formatDuration(startMs / 1000)}
      </Link>
      <span className="text-pretty">
        <HighlightedText text={text} ranges={matchedRanges(text, terms)} />
      </span>
    </li>
  );
}

function SourceGroup({
  item,
  moments,
  terms,
}: {
  item: LibraryItem;
  moments: readonly number[];
  terms: readonly string[];
}) {
  const transcription = useQuery(transcriptionOptions(item.id));
  const passages = transcriptPassages(transcription.data?.transcript?.words ?? []);
  const quoted = moments.map((startMs) => ({
    startMs,
    text: passages.findLast((passage) => passage.startMs <= startMs)?.text ?? "",
  }));
  return (
    <li className="grid gap-1">
      <MediaRow
        item={item}
        title={item.title}
        details={`${formatDuration(item.durationSeconds)} · ${formatDay(item.importedAt)}`}
        status={
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            aria-hidden="true"
            className="text-muted-foreground group-hover:text-foreground"
          />
        }
        className="h-15 hover:bg-subtle"
      />
      {quoted.length > 0 ? (
        <ul className="ml-[58px] grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          {quoted.map((moment) => (
            <QuotedMoment
              key={moment.startMs}
              mediaId={item.id}
              startMs={moment.startMs}
              text={moment.text}
              terms={terms}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AskSources({
  parts,
  recordings,
  moments,
}: {
  parts: readonly ChatPart[];
  recordings: ReadonlyMap<string, LibraryItem>;
  moments: MomentIndex;
}) {
  const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const groups = citedMoments(text, moments).flatMap(({ mediaId, moments: cited }) => {
    const item = recordings.get(mediaId);
    return item ? [{ item, moments: cited }] : [];
  });
  if (groups.length === 0) return null;
  const terms = searchedWords(parts);
  return (
    <ul aria-label="Sources" className="-mx-2.5 mt-1 grid gap-4">
      {groups.map(({ item, moments: cited }) => (
        <SourceGroup key={item.id} item={item} moments={cited} terms={terms} />
      ))}
    </ul>
  );
}
