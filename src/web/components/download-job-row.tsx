import { useId } from "react";
import { ArrowUpRight01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type DownloadJob, getDownloadPreset } from "../../shared/contracts/downloads.ts";
import { cancelDownload, downloadsOptions, retryDownload } from "../lib/api.ts";
import {
  describeDownload,
  describePreset,
  downloadProgress,
  downloadTitle,
  isActiveDownload,
} from "../lib/download-view.ts";
import { formatSourceHost } from "../lib/format.ts";
import { MediaThumbnail } from "./media-thumbnail.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import { Progress } from "./ui/progress.tsx";

function DownloadJobAction({ job, describedBy }: { job: DownloadJob; describedBy: string }) {
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: () => (isActiveDownload(job) ? cancelDownload(job.id) : retryDownload(job.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
  });
  if (job.status === "completed")
    return job.mediaId ? (
      <Link
        to="/media/$mediaId"
        params={{ mediaId: job.mediaId }}
        aria-describedby={describedBy}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Open
      </Link>
    ) : null;
  const cancelling = isActiveDownload(job);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={cancelling ? "ghost" : "outline"}
        size="sm"
        className={cancelling ? "-mr-2.5" : undefined}
        aria-describedby={describedBy}
        aria-busy={action.isPending}
        disabled={action.isPending || job.phase === "saving"}
        onClick={() => action.mutate()}
      >
        {action.isPending ? (
          <Spinner />
        ) : cancelling ? null : (
          <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden="true" />
        )}
        {cancelling
          ? action.isPending
            ? "Cancelling…"
            : "Cancel"
          : action.isPending
            ? "Retrying…"
            : "Retry"}
      </Button>
      {action.isError ? (
        <p role="alert" className="max-w-48 text-right text-xs text-destructive">
          {action.error.message}
        </p>
      ) : null}
    </div>
  );
}

export function DownloadJobRow({ job }: { job: DownloadJob }) {
  const titleId = useId();
  const title = downloadTitle(job);
  const state = describeDownload(job);
  const progress = downloadProgress(job);
  const host = formatSourceHost(job.url);
  const active = isActiveDownload(job);
  const error = job.status === "failed" ? job.error : null;
  const cleanupError = job.cleanupError !== job.error ? job.cleanupError : null;
  return (
    <li className="flex items-start gap-3.5 border-t py-3.5 first:border-t-0">
      <span className="mt-[5px]">
        <MediaThumbnail item={{ id: job.id, kind: getDownloadPreset(job.preset).kind }} />
      </span>
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-sm/5 font-medium max-sm:line-clamp-2 sm:truncate">
          {title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
          <span>{describePreset(job)} ·</span>
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[3px] rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {host ?? "Source"}
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} aria-hidden="true" />
          </a>
        </p>
        <div className="mt-2 flex leading-[normal]">
          <StatusIndicator tone={state.tone}>{state.label}</StatusIndicator>
        </div>
        {progress === null ? null : (
          <Progress value={progress} aria-labelledby={titleId} className="mt-2 block" />
        )}
        {job.transcribe && (active || job.status === "completed") ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {active
              ? "Transcription starts after the download."
              : "Transcription was queued after the download."}
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 text-[12.5px]/[19px] wrap-anywhere text-destructive">{error}</p>
        ) : null}
        {cleanupError ? (
          <p className="mt-1 text-[12.5px]/[19px] wrap-anywhere text-warning">{cleanupError}</p>
        ) : null}
      </div>
      <div className="shrink-0 self-center">
        <DownloadJobAction job={job} describedBy={titleId} />
      </div>
    </li>
  );
}
