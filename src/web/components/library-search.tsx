import { useEffect, useRef, useState } from "react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { maxSearchLength, type LibraryQuery } from "../../shared/contracts/library.ts";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group.tsx";

const searchDelayMs = 250;

export function LibrarySearch({ search }: { search: LibraryQuery }) {
  const navigate = useNavigate({ from: "/" });
  const input = useRef<HTMLInputElement>(null);
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
  return (
    <InputGroup className="mt-[22px]">
      <InputGroupAddon className="pr-1 pl-3">
        <HugeiconsIcon icon={Search01Icon} className="size-4" aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        type="search"
        aria-label="Search"
        maxLength={maxSearchLength}
        autoComplete="off"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder="Search titles and transcripts"
        className="pl-2.5 text-base md:text-sm [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft ? (
        <InputGroupAddon align="inline-end" className="pr-1.5 has-[>button]:mr-0">
          <InputGroupButton
            size="icon-sm"
            aria-label="Clear search"
            onClick={() => {
              setDraft("");
              void navigate({
                search: (previous) => ({ ...previous, q: undefined }),
                replace: true,
              });
              input.current?.focus();
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
