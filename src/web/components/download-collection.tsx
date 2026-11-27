import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Playlist03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { maxDownloadLinks } from "../../shared/contracts/downloads.ts";
import type { YouTubeCollection } from "../../shared/download-sources.ts";
import { ApiError, collectionOptions, ytdlpOptions } from "../lib/api.ts";
import { countLabel, type LinkRow } from "../lib/download-links.ts";
import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./media-thumbnail.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { YtdlpSetup } from "./ytdlp-setup.tsx";

export function CollectionSource({
  kind,
  title,
}: {
  kind: YouTubeCollection["kind"];
  title: string | null | undefined;
}) {
  const type = kind === "playlist" ? "YouTube playlist" : "YouTube channel";
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center text-muted-foreground">
        <HugeiconsIcon icon={Playlist03Icon} size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span
          className="line-clamp-3 text-[13px]/[18px] font-medium wrap-anywhere text-foreground"
          title={title ?? undefined}
        >
          {title || type}
        </span>
        {title ? <span className="block text-xs/4 text-muted-foreground">{type}</span> : null}
      </span>
    </span>
  );
}

export function DownloadCollection({
  source,
  rows,
  onBack,
  onAdd,
}: {
  source: YouTubeCollection;
  rows: readonly LinkRow[];
  onBack: (title?: string | null) => void;
  onAdd: (urls: readonly string[], title?: string | null) => void;
}) {
  const id = useId();
  const back = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const ytdlp = useQuery(ytdlpOptions);
  const ready = ytdlp.data?.ytdlp.state === "ready";
  const queryClient = useQueryClient();
  const options = collectionOptions(source.url);
  const collection = useInfiniteQuery({ ...options, enabled: ready });
  const seen = new Set<string>();
  const videos =
    collection.data?.pages.flatMap((page) =>
      page.videos.filter((video) => {
        if (seen.has(video.url)) return false;
        seen.add(video.url);
        return true;
      }),
    ) ?? [];
  const title = collection.data?.pages[0]?.title;
  const existing = new Set(rows.map((row) => row.key));
  const capacity = maxDownloadLinks - rows.length;
  const full = selected.size >= capacity;
  const error = ytdlp.error ?? collection.error;
  const loadingMore = collection.isFetchingNextPage;
  const pageError = collection.isFetchNextPageError ? collection.error : null;
  const restartNeeded = pageError instanceof ApiError && pageError.status === 409;
  useEffect(() => back.current?.focus(), []);

  const loadNextPage = async () => {
    const button = loadMore.current;
    const result = await collection.fetchNextPage();
    if (
      !result.hasNextPage &&
      !result.isError &&
      (document.activeElement === button || document.activeElement === document.body)
    )
      (list.current ?? back.current)?.focus({ preventScroll: true });
  };

  return (
    <>
      <DialogHeader className="shrink-0 flex-row items-center justify-start gap-1.5 pl-3">
        <Button
          ref={back}
          variant="ghost"
          size="icon-sm"
          aria-label="Back to links"
          onClick={() => onBack(title)}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden="true" />
        </Button>
        <DialogTitle>Choose videos</DialogTitle>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-3 px-5 pt-2.5 pb-4 max-sm:px-4">
        <DialogDescription className="shrink-0">
          <CollectionSource kind={source.kind} title={title} />
        </DialogDescription>
        {ytdlp.data && !ready ? (
          <div className="overflow-y-auto overscroll-contain scroll-shadow-y">
            <YtdlpSetup
              className="rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--color-border)]"
              onClose={() => onBack()}
            />
          </div>
        ) : !collection.data ? (
          error ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p role="alert" className="text-xs/[17px] wrap-anywhere text-destructive">
                {error.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void (ytdlp.error ? ytdlp.refetch() : collection.refetch())}
              >
                Try again
              </Button>
            </div>
          ) : (
            <output className="flex items-center gap-2 text-xs/[17px] text-muted-foreground">
              <Spinner /> Loading videos…
            </output>
          )
        ) : (
          <div
            className={cn(
              "flex min-h-0 flex-col",
              pageError ? "gap-2" : "overflow-hidden rounded-xl border bg-background",
            )}
          >
            {videos.length > 0 ? (
              <ul
                ref={list}
                tabIndex={-1}
                aria-label="Collection videos"
                className={cn(
                  "max-h-72 min-h-0 overflow-y-auto overscroll-contain outline-none scroll-shadow-y",
                  pageError && "rounded-xl border",
                )}
              >
                {videos.map((video, index) => {
                  const checkboxId = `${id}-${index}`;
                  const checked = selected.has(video.url);
                  const duplicate = existing.has(video.url);
                  const disabled = duplicate || (full && !checked);
                  return (
                    <li
                      key={video.url}
                      className={cn(
                        "flex items-center gap-2.5 border-t bg-background px-3 first:border-t-0 max-sm:px-2.5",
                        !disabled && "hover:bg-subtle",
                        checked && "bg-tint hover:bg-highlight",
                      )}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (!value) next.delete(video.url);
                            else if (next.size < capacity) next.add(video.url);
                            return next;
                          })
                        }
                      />
                      <label
                        htmlFor={checkboxId}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-2"
                      >
                        <MediaThumbnail
                          item={{ id: video.url, kind: "video" }}
                          className="max-[360px]:hidden"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-[13px]/[18px] font-medium wrap-anywhere",
                              disabled && "text-muted-foreground",
                            )}
                          >
                            {video.title}
                          </span>
                          {duplicate ? (
                            <span className="block text-xs/4 text-muted-foreground">In draft</span>
                          ) : null}
                        </span>
                        {video.durationSeconds !== null ? (
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatDuration(video.durationSeconds)}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-2.5 text-xs/[17px] text-muted-foreground">
                No available videos on this page.
              </p>
            )}
            {collection.hasNextPage ? (
              <div
                className={cn(
                  "flex shrink-0 flex-wrap items-center gap-2 bg-subtle px-3 py-2",
                  pageError ? "justify-end rounded-xl border" : "justify-center border-t",
                )}
              >
                {pageError ? (
                  <div className="flex min-w-0 flex-1 basis-36 items-start gap-2">
                    <HugeiconsIcon
                      icon={AlertCircleIcon}
                      className="mt-px size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p
                      role="alert"
                      className="min-w-0 text-xs/[17px] wrap-anywhere text-muted-foreground"
                    >
                      {pageError.message}
                      {restartNeeded && selected.size > 0
                        ? " Add your selected videos before starting again."
                        : null}
                    </p>
                  </div>
                ) : null}
                <Button
                  ref={loadMore}
                  variant="outline"
                  size="sm"
                  focusableWhenDisabled
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  onClick={() => {
                    if (restartNeeded) {
                      setSelected(new Set());
                      back.current?.focus();
                      void queryClient.resetQueries({ queryKey: options.queryKey, exact: true });
                    } else void loadNextPage();
                  }}
                >
                  {loadingMore ? (
                    <>
                      <Spinner /> Loading more…
                    </>
                  ) : restartNeeded ? (
                    "Start again"
                  ) : collection.isFetchNextPageError ? (
                    "Retry load more"
                  ) : (
                    <>
                      Load more
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        className="size-3.5"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <DialogFooter className="mt-0 shrink-0 flex-row items-center justify-between gap-2 max-sm:px-4 sm:justify-between">
        <div className="flex min-w-0 flex-col gap-x-1.5 text-xs/4 text-muted-foreground sm:flex-row sm:items-baseline">
          <output className="font-medium text-foreground">{selected.size} selected</output>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span>
            {capacity === 0
              ? "Remove a link to make room."
              : full
                ? `${maxDownloadLinks}-link limit reached.`
                : `${countLabel(capacity - selected.size, "slot")} left`}
          </span>
        </div>
        <Button
          disabled={!ready || selected.size === 0}
          onClick={() =>
            onAdd(
              videos.filter((video) => selected.has(video.url)).map((video) => video.url),
              title,
            )
          }
        >
          {selected.size === 0 ? "Add videos" : `Add ${countLabel(selected.size, "video")}`}
        </Button>
      </DialogFooter>
    </>
  );
}
