import { useEffect, useState } from "react";

const searchDelayMs = 250;

export function useSearchDraft(
  query: string | undefined,
  apply: (query: string | undefined) => void,
) {
  const [draft, setDraft] = useState(query ?? "");
  const [appliedQuery, setAppliedQuery] = useState(query);
  if (query !== appliedQuery) {
    setAppliedQuery(query);
    if (draft.trim() !== (query ?? "")) setDraft(query ?? "");
  }
  useEffect(() => {
    const trimmed = draft.trim() || undefined;
    const timer = setTimeout(() => {
      if (trimmed !== query) apply(trimmed);
    }, searchDelayMs);
    return () => clearTimeout(timer);
  }, [draft, query, apply]);
  return [draft, setDraft] as const;
}
