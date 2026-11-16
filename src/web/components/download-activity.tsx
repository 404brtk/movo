import { useEffect, useState } from "react";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { downloadsOptions, mediaListKey } from "../lib/api.ts";
import { countLabel } from "../lib/download-links.ts";
import { downloadProgress, isActiveDownload, unseenRetries } from "../lib/download-view.ts";
import { formatBytes } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { buttonVariants } from "./ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

const slotClassName =
  "inline-flex items-center gap-2 justify-self-end rounded-sm text-xs tabular-nums max-sm:order-last focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

const seenKey = "movo.downloads.seenAt";

function readSeenAt() {
  try {
    return Number(localStorage.getItem(seenKey)) || 0;
  } catch {
    return 0;
  }
}

function storeSeenAt() {
  const now = Date.now();
  try {
    localStorage.setItem(seenKey, String(now));
  } catch {
    return now;
  }
  return now;
}

function useDownloadsSeenAt(onDownloads: boolean) {
  const [seenAt, setSeenAt] = useState(readSeenAt);
  useEffect(() => {
    if (!onDownloads) return undefined;
    storeSeenAt();
    return () => setSeenAt(storeSeenAt());
  }, [onDownloads]);
  return seenAt;
}

export function DownloadActivity() {
  const jobs = useQuery(downloadsOptions);
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const onDownloads = Boolean(matchRoute({ to: "/downloads" }));
  const seenAt = useDownloadsSeenAt(onDownloads);
  const completed = jobs.data
    ?.filter((job) => job.status === "completed")
    .map((job) => job.mediaId)
    .join(",");
  const active = jobs.data?.filter(isActiveDownload) ?? [];
  const toRetry = unseenRetries(jobs.data ?? [], seenAt);
  const running = active.find((job) => job.status === "running");
  const progress = running ? downloadProgress(running) : null;
  const receivedBytes = running?.downloadedBytes ?? 0;
  useEffect(() => {
    if (completed) void queryClient.invalidateQueries({ queryKey: mediaListKey });
  }, [completed, queryClient]);
  if (onDownloads) return null;
  if (active.length > 0)
    return (
      <Link
        to="/downloads"
        className={cn(slotClassName, "text-muted-foreground hover:text-foreground")}
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
  if (toRetry > 0)
    return (
      <Link
        to="/downloads"
        aria-label={`Downloads, ${countLabel(toRetry, "download")} to retry`}
        className={cn(slotClassName, "text-destructive hover:underline")}
      >
        <HugeiconsIcon icon={Download04Icon} size={16} aria-hidden="true" />
        {toRetry} to retry
      </Link>
    );
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/downloads"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "-mr-1.5 justify-self-end max-sm:order-last",
              )}
            />
          }
          aria-label="Downloads"
        >
          <HugeiconsIcon icon={Download04Icon} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Downloads</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
