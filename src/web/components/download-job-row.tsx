import { type RefObject, useId, useRef } from "react";
import {
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type DownloadJob, getDownloadPreset } from "../../shared/contracts/downloads.ts";
import {
  cancelDownload,
  downloadPreviewKey,
  downloadsOptions,
  removeDownload,
  retryDownload,
} from "../lib/api.ts";
import {
  describeDownload,
  describePreset,
  downloadProgress,
  downloadTitle,
  isActiveDownload,
} from "../lib/download-view.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./media-thumbnail.tsx";
import { MenuIcon } from "./menu-icon.tsx";
import { SourceSite } from "./source-site.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button } from "./ui/button.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Progress } from "./ui/progress.tsx";

function focusAfterRemoving(row: HTMLElement | null) {
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
  const target =
    neighbour?.querySelector<HTMLElement>("a, button") ??
    document.querySelector<HTMLElement>("[data-download-link-trigger]");
  return () => target?.focus();
}

function useDownloadMenu(job: DownloadJob, row: RefObject<HTMLLIElement | null>) {
  const queryClient = useQueryClient();
  const { add: addToast } = Toast.useToastManager();
  const remove = useMutation({
    mutationFn: () => removeDownload(job.id),
    onMutate: () => focusAfterRemoving(row.current),
    onSuccess: (jobs, _variables, restoreFocus) => {
      queryClient.setQueryData(downloadsOptions.queryKey, jobs);
      void queryClient.invalidateQueries({ queryKey: downloadPreviewKey });
      restoreFocus();
    },
    onError: (error) =>
      addToast({ title: "Could not remove the download", description: error.message }),
  });
  const copyLink = () =>
    navigator.clipboard.writeText(job.url).then(
      () => addToast({ title: "Link copied" }),
      () =>
        addToast({
          title: "Could not copy the link",
          description: "Allow clipboard access for this page, then try again.",
        }),
    );
  return (
    <>
      <DropdownMenuItem onClick={() => void copyLink()}>
        <MenuIcon icon={Copy01Icon} />
        Copy link
      </DropdownMenuItem>
      {isActiveDownload(job) ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
            Remove from list
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function DownloadJobAction({ job, describedBy }: { job: DownloadJob; describedBy: string }) {
  const queryClient = useQueryClient();
  const cancelling = isActiveDownload(job);
  const action = useMutation({
    mutationFn: () => (cancelling ? cancelDownload(job.id) : retryDownload(job.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
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
  const active = isActiveDownload(job);
  const error = job.status === "failed" ? job.error : null;
  const cleanupError = job.cleanupError !== job.error ? job.cleanupError : null;
  const recording = job.status === "completed" ? job.mediaId : null;
  const row = useRef<HTMLLIElement>(null);
  const menuItems = useDownloadMenu(job, row);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li
            ref={row}
            className={cn(
              "group relative -mx-2.5 flex items-start gap-3.5 rounded-[10px] px-2.5 py-3 transition-colors has-data-popup-open:bg-subtle data-popup-open:bg-subtle",
              recording &&
                "hover:bg-subtle has-[[data-row-link]:focus-visible]:ring-2 has-[[data-row-link]:focus-visible]:ring-ring/50",
            )}
          />
        }
      >
        <span className="mt-[5px]">
          <MediaThumbnail item={{ id: job.id, kind: getDownloadPreset(job.preset).kind }} />
        </span>
        <div className="min-w-0 flex-1">
          {recording ? (
            <Link
              id={titleId}
              to="/media/$mediaId"
              params={{ mediaId: recording }}
              aria-label={`Open ${title}`}
              data-row-link=""
              className="block text-sm/5 font-medium outline-none after:absolute after:inset-0 after:rounded-[10px] max-sm:line-clamp-2 sm:truncate"
            >
              {title}
            </Link>
          ) : (
            <p id={titleId} className="text-sm/5 font-medium max-sm:line-clamp-2 sm:truncate">
              {title}
            </p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
            <span>{describePreset(job)} ·</span>
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="relative rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <SourceSite url={job.url} />
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
        <div className="relative mt-[5px] flex shrink-0 items-start gap-1.5">
          {job.status === "completed" ? null : (
            <DownloadJobAction job={job} describedBy={titleId} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" className="-mr-1.5" />}
              aria-label={`More actions for ${title}`}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-[200px]">{menuItems}</ContextMenuContent>
    </ContextMenu>
  );
}
