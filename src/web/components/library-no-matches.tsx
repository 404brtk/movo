import { Search01Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import type { LibraryQuery } from "../../shared/contracts/library.ts";
import { describeNoMatches } from "../lib/library-view.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { buttonVariants } from "./ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty.tsx";

export function LibraryNoMatches({ search }: { search: LibraryQuery }) {
  const { title, description } = describeNoMatches(search);
  return (
    <Empty className="mt-[88px] gap-0 p-0">
      <EmptyHeader className="max-w-[360px] gap-0">
        <EmptyMedia className="mb-0">
          <AccentIcon icon={Search01Icon} size={30} />
        </EmptyMedia>
        <EmptyTitle className="mt-4 text-[17px]/6 font-semibold tracking-[-0.01em]">
          {title}
        </EmptyTitle>
        <EmptyDescription className="mt-1.5 text-[13.5px]/[21px] text-pretty">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="mt-[18px]">
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Clear search and filters
        </Link>
      </EmptyContent>
    </Empty>
  );
}
