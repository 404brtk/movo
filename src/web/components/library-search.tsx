import { useCallback, useRef } from "react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { maxSearchLength, type LibraryQuery } from "../../shared/contracts/library.ts";
import { useSearchDraft } from "../lib/search-draft.ts";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group.tsx";

export function LibrarySearch({ search }: { search: LibraryQuery }) {
  const navigate = useNavigate({ from: "/" });
  const input = useRef<HTMLInputElement>(null);
  const applyQuery = useCallback(
    (q: string | undefined) =>
      void navigate({ search: (previous) => ({ ...previous, q }), replace: true }),
    [navigate],
  );
  const [draft, setDraft] = useSearchDraft(search.q, applyQuery);
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
              applyQuery(undefined);
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
