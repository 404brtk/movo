import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ChatPart } from "../../shared/contracts/ask.ts";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import { matchedRanges, searchTerms } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptionOptions } from "../lib/api.ts";
import { citedMoments } from "../lib/ask-view.ts";
import { formatDay, formatDuration } from "../lib/format.ts";
import { HighlightedText } from "./highlighted-text.tsx";
import { MediaThumbnail } from "./media-thumbnail.tsx";

function searchedWords(parts: readonly ChatPart[]) {
  const queries = parts.flatMap((part) => {
    if (part.type !== "tool" || part.toolName !== "search_library") return [];
    const query =
      typeof part.input === "object" && part.input !== null ? Reflect.get(part.input, "q") : "";
    return typeof query === "string" ? [query] : [];
  });
  return searchTerms(queries.join(" "));
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
    <li className="grid gap-1.5">
      <div className="flex items-center gap-3">
        <MediaThumbnail item={item} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(item.durationSeconds)} · {formatDay(item.importedAt)}
          </p>
        </div>
        <Link
          to="/media/$mediaId"
          params={{ mediaId: item.id }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open
          <span className="sr-only"> {item.title}</span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} aria-hidden="true" />
        </Link>
      </div>
      {quoted.length > 0 ? (
        <ul className="ml-[56px] grid gap-0.5">
          {quoted.map((moment) => (
            <li
              key={moment.startMs}
              className="flex gap-4 rounded-lg px-2.5 py-2 text-[13.5px]/[21px] hover:bg-subtle"
            >
              <Link
                to="/media/$mediaId"
                params={{ mediaId: item.id }}
                search={{ startMs: moment.startMs }}
                className="shrink-0 font-medium text-primary-strong tabular-nums hover:underline"
              >
                {formatDuration(moment.startMs / 1000)}
              </Link>
              <span className="text-pretty">
                <HighlightedText text={moment.text} ranges={matchedRanges(moment.text, terms)} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AskSources({
  parts,
  recordings,
}: {
  parts: readonly ChatPart[];
  recordings: ReadonlyMap<string, LibraryItem>;
}) {
  const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const groups = citedMoments(text).flatMap(({ mediaId, moments }) => {
    const item = recordings.get(mediaId);
    return item ? [{ item, moments }] : [];
  });
  if (groups.length === 0) return null;
  const terms = searchedWords(parts);
  return (
    <ul aria-label="Sources" className="mt-1 grid gap-4">
      {groups.map(({ item, moments }) => (
        <SourceGroup key={item.id} item={item} moments={moments} terms={terms} />
      ))}
    </ul>
  );
}
