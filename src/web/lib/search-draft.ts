import { useEffect, useState } from "react";

const searchDelayMs = 250;

const trimmedQuery = (draft: string) => draft.trim() || undefined;

export function useSearchDraft(
  query: string | undefined,
  apply: (query: string | undefined) => void,
  queryOf: (draft: string) => string | undefined = trimmedQuery,
) {
  const [draft, setDraft] = useState(query ?? "");
  const [appliedQuery, setAppliedQuery] = useState(query);
  if (query !== appliedQuery) {
    setAppliedQuery(query);
    if (queryOf(draft) !== query) setDraft(query ?? "");
  }
  useEffect(() => {
    const next = queryOf(draft);
    const timer = setTimeout(() => {
      if (next !== query) apply(next);
    }, searchDelayMs);
    return () => clearTimeout(timer);
  }, [draft, query, apply, queryOf]);
  return [draft, setDraft] as const;
}
