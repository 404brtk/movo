import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { LibraryQuery, librarySort, librarySorts } from "../../shared/contracts/library.ts";
import { sortLabels } from "../lib/library-view.ts";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

const decodeSort = Schema.decodeUnknownSync(LibraryQuery.fields.sort);

export function LibrarySort({ search }: { search: LibraryQuery }) {
  const navigate = useNavigate({ from: "/" });
  const sort = librarySort(search);
  const defaultSort = librarySort({ ...search, sort: undefined });
  const options = librarySorts.filter(
    (option) => option !== "relevance" || defaultSort === "relevance",
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="-mr-2.5" />}
        aria-label={`Sort by ${sortLabels[sort]}`}
      >
        {sortLabels[sort]}
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => {
            const selected = decodeSort(value);
            void navigate({
              search: (previous) => ({
                ...previous,
                sort: selected === defaultSort ? undefined : selected,
              }),
            });
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} closeOnClick>
              {sortLabels[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
