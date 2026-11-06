import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { downloadsOptions, mediaListKey } from "../lib/api.ts";

export function DownloadActivity() {
  const jobs = useQuery(downloadsOptions);
  const queryClient = useQueryClient();
  const completed = jobs.data
    ?.filter((job) => job.status === "completed")
    .map((job) => job.mediaId)
    .join(",");
  const active =
    jobs.data?.filter((job) => job.status === "queued" || job.status === "running").length ?? 0;
  useEffect(() => {
    if (completed) void queryClient.invalidateQueries({ queryKey: mediaListKey });
  }, [completed, queryClient]);
  return (
    <nav aria-label="Main navigation" className="flex items-center gap-1">
      <Link
        to="/models"
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        Models
      </Link>
      <Link
        to="/downloads"
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        Downloads
        {active > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{active}</span>
        ) : null}
      </Link>
    </nav>
  );
}
