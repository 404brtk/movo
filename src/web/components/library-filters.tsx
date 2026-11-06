import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { LibraryQuery, librarySort, maxSearchLength } from "../../shared/contracts/library.ts";
import { searchTerms } from "../../shared/search-text.ts";

const searchDelayMs = 250;
const controlClassName =
  "h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function LibraryFilters({ search }: { search: LibraryQuery }) {
  const navigate = useNavigate({ from: "/" });
  const [draft, setDraft] = useState(search.q ?? "");
  const [appliedQuery, setAppliedQuery] = useState(search.q);
  if (search.q !== appliedQuery) {
    setAppliedQuery(search.q);
    if (draft.trim() !== (search.q ?? "")) setDraft(search.q ?? "");
  }
  useEffect(() => {
    const q = draft.trim() || undefined;
    const timer = setTimeout(() => {
      if (q !== search.q)
        void navigate({ search: (previous) => ({ ...previous, q }), replace: true });
    }, searchDelayMs);
    return () => clearTimeout(timer);
  }, [draft, search.q, navigate]);
  const sort = librarySort(search);
  const defaultSort = librarySort({ ...search, sort: undefined });
  return (
    <search
      aria-label="Library"
      className="mb-6 grid gap-3 sm:grid-cols-3 md:grid-cols-[minmax(0,1fr)_8rem_10rem_9rem]"
    >
      <div className="space-y-2 sm:col-span-3 md:col-span-1">
        <label htmlFor="library-search" className="block text-sm font-medium">
          Search
        </label>
        <input
          id="library-search"
          type="search"
          maxLength={maxSearchLength}
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Titles and transcripts"
          className={`${controlClassName} text-base`}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="library-kind" className="block text-sm font-medium">
          Type
        </label>
        <select
          id="library-kind"
          value={search.kind ?? ""}
          onChange={(event) => {
            const kind = Schema.decodeUnknownSync(LibraryQuery.fields.kind)(
              event.currentTarget.value || undefined,
            );
            void navigate({ search: (previous) => ({ ...previous, kind }) });
          }}
          className={controlClassName}
        >
          <option value="">All</option>
          <option value="audio">Audio</option>
          <option value="video">Video</option>
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="library-transcript" className="block text-sm font-medium">
          Transcript
        </label>
        <select
          id="library-transcript"
          value={search.transcript ?? ""}
          onChange={(event) => {
            const transcript = Schema.decodeUnknownSync(LibraryQuery.fields.transcript)(
              event.currentTarget.value || undefined,
            );
            void navigate({ search: (previous) => ({ ...previous, transcript }) });
          }}
          className={controlClassName}
        >
          <option value="">Any</option>
          <option value="available">Transcribed</option>
          <option value="missing">Not transcribed</option>
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="library-sort" className="block text-sm font-medium">
          Sort by
        </label>
        <select
          id="library-sort"
          value={sort}
          onChange={(event) => {
            const selected = Schema.decodeUnknownSync(LibraryQuery.fields.sort)(
              event.currentTarget.value,
            );
            void navigate({
              search: (previous) => ({
                ...previous,
                sort: selected === defaultSort ? undefined : selected,
              }),
            });
          }}
          className={controlClassName}
        >
          {searchTerms(search.q ?? "").length > 0 ? (
            <option value="relevance">Best match</option>
          ) : null}
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title">Title</option>
        </select>
      </div>
    </search>
  );
}
