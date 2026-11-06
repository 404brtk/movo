import { FolderLibraryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  LibraryQuery,
  type LibraryItem,
  type LibraryMatch,
} from "../../shared/contracts/library.ts";
import { HighlightedText } from "../components/highlighted-text.tsx";
import { ImportMedia } from "../components/import-media.tsx";
import { DownloadLink } from "../components/download-link.tsx";
import { LibraryFilters } from "../components/library-filters.tsx";
import { MediaIcon } from "../components/media-icon.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { mediaListOptions } from "../lib/api.ts";
import { formatBytes, formatDuration, formatImportDate } from "../lib/format.ts";
import { searchParams } from "../lib/search-params.ts";

export const Route = createFileRoute("/")({
  validateSearch: searchParams(LibraryQuery),
  component: Home,
});

function PassageMatches({ item, match }: { item: LibraryItem; match: LibraryMatch }) {
  const hidden = match.passageCount - match.passages.length;
  return (
    <div className="space-y-1 pb-4 pl-2 md:pl-4">
      <ol aria-label={`Matches in ${item.title}`} className="space-y-1">
        {match.passages.map((passage, index) => (
          <li key={index}>
            <Link
              to="/media/$mediaId"
              params={{ mediaId: item.id }}
              search={{ startMs: passage.startMs }}
              className="flex min-h-10 gap-4 rounded-md px-2 py-2 text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="w-11 shrink-0 text-muted-foreground tabular-nums">
                {formatDuration(passage.startMs / 1000)}
              </span>
              <span className="min-w-0 leading-6 wrap-anywhere">
                <HighlightedText text={passage.text} ranges={passage.ranges} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {hidden > 0 ? (
        <p className="pl-17 text-xs text-muted-foreground">
          {hidden} more {hidden === 1 ? "match" : "matches"} in this recording
        </p>
      ) : null}
    </div>
  );
}

function Home() {
  const search = Route.useSearch();
  const library = useQuery(mediaListOptions(search));
  const filtered = Boolean(search.q?.trim() || search.kind || search.transcript);
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="mb-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-[-0.045em]">Library</h1>
          <p className="text-sm text-muted-foreground">Audio and video, saved in one place.</p>
        </div>
        <ImportMedia />
      </div>
      <DownloadLink />
      {filtered || (library.data?.length ?? 0) > 0 ? <LibraryFilters search={search} /> : null}
      {library.isPending ? (
        <output className="block py-12 text-sm text-muted-foreground">Loading your library…</output>
      ) : null}
      {library.isError ? (
        <div role="alert" className="space-y-4 rounded-lg border p-6">
          <p className="text-sm">{library.error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void library.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {library.data?.length === 0 && filtered ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
          <h2 className="text-lg font-medium tracking-tight">No recordings match</h2>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            Try other words or change the filters.
          </p>
          <Link
            to="/"
            className={buttonVariants({ variant: "outline", className: "h-10 px-3 text-sm" })}
          >
            Clear search and filters
          </Link>
        </div>
      ) : null}
      {library.data?.length === 0 && !filtered ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="mb-5 text-muted-foreground">
            <HugeiconsIcon icon={FolderLibraryIcon} size={36} aria-hidden="true" />
          </span>
          <h2 className="text-lg font-medium tracking-tight">Your library starts here</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Import an audio or video file to save a copy. Your original stays where it is.
          </p>
          <p className="mt-5 text-xs text-muted-foreground">
            Files up to 10 GiB. No model download needed.
          </p>
        </div>
      ) : null}
      {library.data && library.data.length > 0 ? (
        <section aria-label="Saved media" aria-busy={library.isPlaceholderData}>
          <div className="mb-4 flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <output>
              {library.data.length} {filtered ? "result" : "file"}
              {library.data.length === 1 ? "" : "s"}
            </output>
            <p>A separate copy of every import</p>
          </div>
          <div
            className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] gap-5 border-y px-4 py-3 text-xs text-muted-foreground md:grid"
            aria-hidden="true"
          >
            <span>File</span>
            <span>Duration</span>
            <span>Size</span>
            <span>Imported</span>
          </div>
          <ul aria-label="Media library" className="divide-y border-b">
            {library.data.map((item) => (
              <li key={item.id}>
                <Link
                  to="/media/$mediaId"
                  params={{ mediaId: item.id }}
                  aria-label={`Open ${item.title}`}
                  className="grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-5 rounded-md px-2 py-4 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] md:px-4"
                >
                  <span className="flex min-w-0 items-center gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <MediaIcon kind={item.kind} />
                    </span>
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-sm font-medium">
                        <HighlightedText text={item.title} ranges={item.match?.title ?? []} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.originalName}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDuration(item.durationSeconds)}
                  </span>
                  <span className="hidden text-xs text-muted-foreground tabular-nums md:block">
                    {formatBytes(item.byteSize)}
                  </span>
                  <time
                    className="hidden text-xs text-muted-foreground md:block"
                    dateTime={new Date(item.importedAt).toISOString()}
                  >
                    {formatImportDate(item.importedAt)}
                  </time>
                </Link>
                {item.match && item.match.passages.length > 0 ? (
                  <PassageMatches item={item} match={item.match} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
