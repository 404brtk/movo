import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LibraryQuery, librarySort } from "../../shared/contracts/library.ts";
import { searchTerms } from "../../shared/search-text.ts";
import { LibraryActions } from "../components/library-actions.tsx";
import { LibraryFilters } from "../components/library-filters.tsx";
import { LibraryList } from "../components/library-list.tsx";
import { LibraryNoMatches } from "../components/library-no-matches.tsx";
import { LibrarySearch } from "../components/library-search.tsx";
import { LibrarySearchResults } from "../components/library-search-results.tsx";
import { ListSkeleton } from "../components/list-skeleton.tsx";
import { LibrarySort } from "../components/library-sort.tsx";
import { LibraryFacts, LibraryWelcome } from "../components/library-welcome.tsx";
import { Button } from "../components/ui/button.tsx";
import { mediaListOptions } from "../lib/api.ts";
import { searchParams } from "../lib/search-params.ts";

export const Route = createFileRoute("/")({
  validateSearch: searchParams(LibraryQuery),
  component: Library,
});

function Library() {
  const search = Route.useSearch();
  const library = useQuery(mediaListOptions(search));
  const items = library.data?.items;
  const filtered = Boolean(search.q?.trim() || search.kind || search.transcript);
  const searching = searchTerms(search.q ?? "").length > 0;
  const sort = librarySort(search);
  const firstRun = items?.length === 0 && !filtered;
  return (
    <main className="mx-auto flex max-w-[800px] flex-wrap items-end gap-x-4 px-5 pt-9 pb-16">
      <h1 className="text-[28px]/[34px] font-semibold tracking-[-0.025em] text-balance">Library</h1>
      {firstRun ? <LibraryWelcome /> : null}
      <div className={firstRun ? "mt-[22px] flex w-full justify-center" : "ml-auto max-sm:mt-3"}>
        <LibraryActions />
      </div>
      {firstRun ? (
        <LibraryFacts />
      ) : (
        <div className="w-full">
          <search aria-label="Library">
            <LibrarySearch search={search} />
            {items ? (
              <LibraryFilters search={search}>
                {items.length > 0 ? (
                  <span className="flex items-center gap-1">
                    {searching ? (
                      <output className="text-xs text-muted-foreground">
                        {items.length} {items.length === 1 ? "recording" : "recordings"}
                        <span aria-hidden="true"> ·</span>
                      </output>
                    ) : null}
                    <LibrarySort search={search} />
                  </span>
                ) : null}
              </LibraryFilters>
            ) : null}
          </search>
          {library.isPending ? <ListSkeleton /> : null}
          {library.isError ? (
            <div role="alert" className="mt-8 space-y-4 rounded-lg border p-6">
              <p className="text-sm">{library.error.message}</p>
              <Button variant="outline" onClick={() => void library.refetch()}>
                Try again
              </Button>
            </div>
          ) : null}
          {items?.length === 0 && filtered ? <LibraryNoMatches search={search} /> : null}
          {items && items.length > 0 ? (
            <div aria-busy={library.isPlaceholderData}>
              {searching ? (
                <LibrarySearchResults items={items} />
              ) : (
                <LibraryList items={items} sort={sort} />
              )}
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
