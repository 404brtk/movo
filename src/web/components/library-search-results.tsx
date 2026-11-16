import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import { formatDuration } from "../lib/format.ts";
import { HighlightedText } from "./highlighted-text.tsx";
import { LibraryRow } from "./library-row.tsx";

function SearchResult({ item, query }: { item: LibraryItem; query: string }) {
  const passages = item.match?.passages ?? [];
  const moreInRecording = (item.match?.everyWordPassageCount ?? 0) > passages.length;
  const untranscribed = item.transcription === "none" || item.transcription === "stopped";
  return (
    <li>
      <LibraryRow
        item={item}
        title={<HighlightedText text={item.title} ranges={item.match?.title ?? []} />}
        detailed={false}
        offerTranscribe={false}
        className="-mx-2.5 h-14"
      />
      {untranscribed ? (
        <p className="-mt-1.5 pb-2 pl-[58px] text-xs text-muted-foreground">
          Title and file name only — transcribe it to search what was said.
        </p>
      ) : null}
      {passages.length > 0 ? (
        <ol aria-label={`Matches in ${item.title}`} className="grid gap-0.5 pb-2.5 pl-[58px]">
          {passages.map((passage, index) => (
            <li key={index}>
              <Link
                to="/media/$mediaId"
                params={{ mediaId: item.id }}
                search={{ startMs: passage.startMs }}
                className="-mx-2.5 grid grid-cols-[44px_minmax(0,1fr)] gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px]/[21px] hover:bg-subtle focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="text-xs/[21px] text-muted-foreground tabular-nums">
                  {formatDuration(passage.startMs / 1000)}
                </span>
                <span className="wrap-anywhere">
                  {passage.speaker ? (
                    <>
                      <span className="font-semibold">
                        <HighlightedText
                          text={passage.speaker.name}
                          ranges={passage.speaker.ranges}
                        />
                      </span>
                      {": "}
                    </>
                  ) : null}
                  <HighlightedText text={passage.text} ranges={passage.ranges} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      {moreInRecording ? (
        <Link
          to="/media/$mediaId"
          params={{ mediaId: item.id }}
          search={{ q: query }}
          className="ml-12 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-primary-strong hover:bg-tint focus-visible:outline-2 focus-visible:outline-ring"
        >
          Search in this recording
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </li>
  );
}

export function LibrarySearchResults({
  items,
  query,
}: {
  items: readonly LibraryItem[];
  query: string;
}) {
  return (
    <section aria-label="Media library">
      <ul className="mt-5 grid grid-cols-1 gap-1.5">
        {items.map((item) => (
          <SearchResult key={item.id} item={item} query={query} />
        ))}
      </ul>
    </section>
  );
}
