import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { LibraryQuery } from "../../shared/contracts/library.ts";
import { SegmentedChoice } from "./segmented-choice.tsx";

export function LibraryFilters({
  search,
  children,
}: {
  search: LibraryQuery;
  children?: ReactNode;
}) {
  const navigate = useNavigate({ from: "/" });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <SegmentedChoice
        label="Type"
        size="sm"
        options={[
          ["any", "All"],
          ["audio", "Audio"],
          ["video", "Video"],
        ]}
        value={search.kind ?? "any"}
        onValueChange={(kind) =>
          void navigate({
            search: (previous) => ({ ...previous, kind: kind === "any" ? undefined : kind }),
          })
        }
      />
      <SegmentedChoice
        label="Transcript"
        size="sm"
        options={[
          ["any", "Any"],
          ["available", "Transcribed"],
          ["missing", "Not yet"],
        ]}
        value={search.transcript ?? "any"}
        onValueChange={(transcript) =>
          void navigate({
            search: (previous) => ({
              ...previous,
              transcript: transcript === "any" ? undefined : transcript,
            }),
          })
        }
      />
      <div className="ml-auto">{children}</div>
    </div>
  );
}
