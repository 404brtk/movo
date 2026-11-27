import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { maxDownloadLinks } from "../../shared/contracts/downloads.ts";
import type { YouTubeCollection } from "../../shared/download-sources.ts";
import { collectionOptions, ytdlpOptions } from "../lib/api.ts";
import { countLabel, type LinkRow } from "../lib/download-links.ts";
import { formatDuration } from "../lib/format.ts";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { YtdlpSetup } from "./ytdlp-setup.tsx";

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
  const collection = useInfiniteQuery({ ...collectionOptions(source.url), enabled: ready });
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
      <DialogHeader className="shrink-0 flex-row items-start justify-start gap-2 pl-2">
        <Button
          ref={back}
          variant="ghost"
          size="icon-sm"
          aria-label="Back to links"
          onClick={() => onBack(title)}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden="true" />
        </Button>
        <div className="min-w-0 pt-0.5">
          <DialogTitle>Choose videos</DialogTitle>
          <DialogDescription className="line-clamp-2 wrap-anywhere" title={title ?? undefined}>
            {title ?? (source.kind === "playlist" ? "YouTube playlist" : "YouTube channel")}
          </DialogDescription>
        </div>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-2 px-5 pt-3.5 pb-2">
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
          <>
            {videos.length > 0 ? (
              <ul
                ref={list}
                tabIndex={-1}
                aria-label="Collection videos"
                className="max-h-72 min-h-0 overflow-y-auto overscroll-contain rounded-xl shadow-[inset_0_0_0_1px_var(--color-border)] outline-none scroll-shadow-y"
              >
                {videos.map((video, index) => {
                  const checkboxId = `${id}-${index}`;
                  const checked = selected.has(video.url);
                  const duplicate = existing.has(video.url);
                  return (
                    <li
                      key={video.url}
                      className="flex items-center gap-2.5 border-t px-3 first:border-t-0 hover:bg-subtle"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        disabled={duplicate || (full && !checked)}
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
                        className="flex min-w-0 flex-1 items-center gap-2 py-2.5"
                      >
                        <span className="min-w-0 flex-1 text-[13px]/[18px] font-medium wrap-anywhere">
                          {video.title}
                        </span>
                        {duplicate ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Already added
                          </span>
                        ) : null}
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
              <p className="text-xs/[17px] text-muted-foreground">
                No available videos on this page.
              </p>
            )}
            {collection.hasNextPage ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                {collection.isFetchNextPageError ? (
                  <p role="alert" className="min-w-0 text-xs/[17px] wrap-anywhere text-destructive">
                    {collection.error.message}
                  </p>
                ) : null}
                <Button
                  ref={loadMore}
                  className="ml-auto"
                  variant="outline"
                  size="sm"
                  focusableWhenDisabled
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  onClick={() => void loadNextPage()}
                >
                  {loadingMore ? (
                    <>
                      <Spinner /> Loading more…
                    </>
                  ) : collection.isFetchNextPageError ? (
                    "Retry load more"
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <DialogFooter className="mt-3 shrink-0 sm:justify-between">
        <div className="text-xs text-muted-foreground">
          <output className="font-medium text-foreground">{selected.size} selected</output>
          {full ? (
            <p className="mt-0.5">
              {capacity === 0
                ? "Remove a link to make room."
                : `${maxDownloadLinks}-link limit reached.`}
            </p>
          ) : null}
        </div>
        <Button
          className="max-sm:self-end"
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
