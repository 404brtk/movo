import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { downloadsOptions, mediaListKey } from "../lib/api.ts";
import { downloadProgress, isActiveDownload } from "../lib/download-view.ts";
import { formatBytes } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

export function useActiveDownloads() {
  const jobs = useQuery(downloadsOptions);
  return jobs.data?.filter(isActiveDownload) ?? [];
}

export function DownloadActivity() {
  const jobs = useQuery(downloadsOptions);
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const completed = jobs.data
    ?.filter((job) => job.status === "completed")
    .map((job) => job.mediaId)
    .join(",");
  const active = jobs.data?.filter(isActiveDownload) ?? [];
  const running = active.find((job) => job.status === "running");
  const progress = running ? downloadProgress(running) : null;
  const receivedBytes = running?.downloadedBytes ?? 0;
  useEffect(() => {
    if (completed) void queryClient.invalidateQueries({ queryKey: mediaListKey });
  }, [completed, queryClient]);
  if (active.length === 0 || matchRoute({ to: "/downloads" })) return null;
  return (
    <Link
      to="/downloads"
      className="inline-flex items-center gap-2 justify-self-end rounded-sm text-xs text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span
        className={cn(
          "size-3.5 rounded-full bg-[conic-gradient(var(--color-primary)_var(--progress),var(--color-border)_0)] [mask-image:radial-gradient(circle_4.5px,transparent_98%,black)]",
          progress === null && "motion-safe:animate-spin",
        )}
        style={{ "--progress": `${progress ?? 25}%` }}
      />
      Downloading
      {progress === null
        ? receivedBytes > 0
          ? ` · ${formatBytes(receivedBytes)}`
          : ""
        : ` · ${Math.floor(progress)}%`}
    </Link>
  );
}
