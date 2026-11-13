import { useRef, useState } from "react";
import { Cancel01Icon, Download04Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import {
  type UseQueryResult,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  defaultDownloadPreset,
  downloadPresets,
  type DownloadPreset,
  type DownloadPreview,
  downloadSiteNames,
  getDownloadPreset,
} from "../../shared/contracts/downloads.ts";
import { downloadsOptions, enqueueDownload, previewOptions, ytdlpOptions } from "../lib/api.ts";
import {
  addLinks,
  canChooseKind,
  countLabel,
  type LinkRow,
  linkPreset,
  type LinkSkip,
  linkSkip,
  linkTitle,
  type SaveKind,
} from "../lib/download-links.ts";
import { formatDuration, formatSourceHost } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./media-thumbnail.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Switch } from "./ui/switch.tsx";
import { YtdlpSetup } from "./ytdlp-setup.tsx";

const simultaneousChecks = 2;

const kindOptions = [
  ["video", "Video"],
  ["audio", "Audio"],
] as const;

const qualityOptions = downloadPresets
  .filter((option) => option.kind === "video")
  .map(
    (option) => [option.id, option.maxHeight === null ? "Best" : `${option.maxHeight}p`] as const,
  );

interface LinkView {
  row: LinkRow;
  preview: UseQueryResult<DownloadPreview> | undefined;
  preset: DownloadPreset;
  skip: LinkSkip | null;
}

function LinkDetails({ view }: { view: LinkView }) {
  const { row, preview, skip } = view;
  if (skip)
    return (
      <>
        <StatusIndicator tone={skip.tone}>{skip.message}</StatusIndicator>
        {skip.reason === "saved" ? (
          <Link
            to="/media/$mediaId"
            params={{ mediaId: skip.mediaId }}
            className="rounded-sm text-[12.5px] font-medium text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open
          </Link>
        ) : null}
      </>
    );
  if (preview?.data)
    return (
      <span className="truncate tabular-nums">
        {[
          formatSourceHost(preview.data.url),
          preview.data.durationSeconds === null
            ? null
            : formatDuration(preview.data.durationSeconds),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    );
  if (preview?.isFetching)
    return (
      <>
        <Spinner />
        Checking…
      </>
    );
  return row.source ? "Waiting to check" : null;
}

function LinkItem({
  view,
  onKindChange,
  onRemove,
  locked,
}: {
  view: LinkView;
  onKindChange: (kind: SaveKind) => void;
  onRemove: () => void;
  locked: boolean;
}) {
  const { row, preview, preset, skip } = view;
  const title = linkTitle(row, preview?.data);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-2.5 py-2 first:border-t-0 sm:flex-nowrap">
      {preview?.data && !skip ? (
        <MediaThumbnail item={{ id: row.key, kind: getDownloadPreset(preset).kind }} />
      ) : (
        <span aria-hidden="true" className="h-7 w-11 shrink-0 rounded-[7px] bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={
            preview?.data
              ? "truncate text-[13px]/[18px] font-medium"
              : "truncate text-[13px]/[18px] text-muted-foreground"
          }
        >
          {title}
        </p>
        <div className="mt-px flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs/4 text-muted-foreground">
          <LinkDetails view={view} />
        </div>
      </div>
      <div className="flex justify-end max-sm:order-last max-sm:w-full max-sm:pl-14 sm:w-[122px] sm:shrink-0">
        {skip?.reason === "unsupported" ? null : skip?.reason === "unavailable" ? (
          <Button
            variant="outline"
            size="sm"
            aria-busy={preview?.isFetching}
            disabled={locked || preview?.isFetching}
            onClick={() => void preview?.refetch()}
          >
            Check again
          </Button>
        ) : canChooseKind(row) ? (
          <SegmentedChoice
            label={`Save ${title} as`}
            size="sm"
            options={kindOptions}
            value={row.kind}
            disabled={locked}
            onValueChange={onKindChange}
          />
        ) : (
          <span className="pr-2.5 text-xs/7 text-muted-foreground">Audio only</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Remove ${title}`}
        disabled={locked}
        onClick={onRemove}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden="true" />
      </Button>
    </li>
  );
}

export function DownloadLink() {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<LinkRow[]>([]);
  const [lastKind, setLastKind] = useState<SaveKind>("video");
  const [videoPreset, setVideoPreset] = useState<DownloadPreset>(defaultDownloadPreset);
  const [transcribe, setTranscribe] = useState(false);
  const [ytdlpDismissed, setYtdlpDismissed] = useState(false);
  const linksInput = useRef<HTMLInputElement>(null);
  const ytdlp = useQuery(ytdlpOptions);
  const jobs = useQuery(downloadsOptions);
  const queryClient = useQueryClient();
  const toastManager = Toast.useToastManager();
  const navigate = useNavigate();
  const onDownloadsPage = Boolean(useMatchRoute()({ to: "/downloads" }));
  const ready = ytdlp.data?.ytdlp.state === "ready";
  const checks = rows.map((row) => {
    const options = previewOptions(row.source?.url ?? "");
    const status = queryClient.getQueryState(options.queryKey)?.status;
    return { row, options, settled: status === "success" || status === "error" };
  });
  const running = new Set(
    checks
      .filter((check) => check.row.source && !check.settled)
      .slice(0, simultaneousChecks)
      .map((check) => check.row.key),
  );
  const previews = useQueries({
    queries: checks.map(({ row, options, settled }) => ({
      ...options,
      enabled: open && ready && row.source !== undefined && (settled || running.has(row.key)),
    })),
  });
  const views: LinkView[] = rows.map((row, index) => {
    const preview = previews[index];
    const preset = linkPreset(row, videoPreset);
    return {
      row,
      preview,
      preset,
      skip: linkSkip(row, preset, preview ?? { error: null }, jobs.data ?? []),
    };
  });
  const queued = views.filter((view) => !view.skip);
  const skipped = views.length - queued.length;
  const choosable = rows.filter(canChooseKind);
  const sharedKind =
    choosable.length > 0 && choosable.every((row) => row.kind === choosable[0]?.kind)
      ? (choosable[0]?.kind ?? null)
      : null;
  const videoLinks = queued.filter((view) => getDownloadPreset(view.preset).kind === "video");
  const download = useMutation({
    mutationFn: enqueueDownload,
    onSuccess: async (_jobs, request) => {
      const rest = addLinks([], field, lastKind);
      setRows(rest.rows);
      setField(rest.remaining);
      setNote(rest.note);
      setOpen(rest.rows.length > 0);
      await queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey });
      toastManager.add({
        title: `${countLabel(request.links.length, "download")} added`,
        description: skipped > 0 ? `${countLabel(skipped, "link")} skipped.` : undefined,
        ...(onDownloadsPage
          ? {}
          : {
              actionProps: {
                children: "View downloads",
                onClick: () => void navigate({ to: "/downloads" }),
              },
            }),
      });
    },
  });
  const add = (text: string) => {
    const result = addLinks(rows, text, lastKind);
    setRows(result.rows);
    setField(result.remaining);
    setNote(result.note);
    download.reset();
  };
  const updateRows = (change: (row: LinkRow) => LinkRow) => {
    setRows((current) => current.map(change));
    download.reset();
  };
  const chooseKind = (key: string, kind: SaveKind) => {
    setLastKind(kind);
    updateRows((row) => (row.key === key ? { ...row, kind } : row));
  };
  const remove = (keys: readonly string[]) => {
    setRows((current) => current.filter((row) => !keys.includes(row.key)));
    download.reset();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={Link01Icon} data-icon="inline-start" aria-hidden="true" />
        Download from link
      </DialogTrigger>
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>Download from links</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col overflow-y-auto px-5 pt-3.5 pb-2">
          <label htmlFor="download-links" className="mb-1.5 block text-xs font-medium">
            Add links
          </label>
          <Input
            ref={linksInput}
            id="download-links"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste one or more links"
            value={field}
            disabled={download.isPending}
            aria-describedby={note || rows.length === 0 ? "download-links-help" : undefined}
            onChange={(event) => {
              setField(event.target.value);
              setNote(null);
            }}
            onPaste={(event) => {
              event.preventDefault();
              add(`${field} ${event.clipboardData.getData("text")}`);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              add(field);
            }}
          />
          {note || rows.length === 0 ? (
            <p
              id="download-links-help"
              role={note ? "status" : undefined}
              className="mt-1.5 text-xs/[17px] text-muted-foreground"
            >
              {note ??
                `Videos and podcast episodes from ${downloadSiteNames}. Sign-in is not supported.`}
            </p>
          ) : null}
          {rows.length > 0 &&
          ytdlp.data &&
          (!ready || ytdlp.data.installation.phase === "complete") &&
          !ytdlpDismissed ? (
            <YtdlpSetup
              className="mt-4 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--color-border)]"
              onClose={() => {
                setYtdlpDismissed(true);
                linksInput.current?.focus();
              }}
            />
          ) : null}
          {rows.length > 0 ? (
            <>
              <div className="mt-4 mb-1.5 flex min-h-7 flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {countLabel(rows.length, "link")}
                  </span>
                  {skipped > 0 ? (
                    <>
                      <span>· {skipped} skipped</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={download.isPending}
                        onClick={() =>
                          remove(views.filter((view) => view.skip).map((view) => view.row.key))
                        }
                      >
                        Remove skipped
                      </Button>
                    </>
                  ) : null}
                </div>
                {rows.length > 1 && choosable.length > 0 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden="true">Set all to</span>
                    <SegmentedChoice
                      label="Save every link as"
                      disabled={download.isPending}
                      size="sm"
                      options={kindOptions}
                      value={sharedKind}
                      onValueChange={(kind) => {
                        setLastKind(kind);
                        updateRows((row) => (canChooseKind(row) ? { ...row, kind } : row));
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <ul
                aria-label="Links"
                className={cn(
                  "overflow-y-auto overscroll-contain rounded-xl shadow-[inset_0_0_0_1px_var(--color-border)] scroll-shadow-y",
                  rows.length > 2 ? "min-h-28" : "min-h-fit",
                )}
              >
                {[...views.filter((view) => view.skip), ...queued].map((view) => (
                  <LinkItem
                    key={view.row.key}
                    view={view}
                    onKindChange={(kind) => chooseKind(view.row.key, kind)}
                    onRemove={() => remove([view.row.key])}
                    locked={download.isPending}
                  />
                ))}
              </ul>
              <div className="mt-4 grid grid-cols-1 items-center gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr] sm:gap-y-3">
                {videoLinks.length > 0 ? (
                  <>
                    <span className="text-[12.5px] font-medium text-muted-foreground">Quality</span>
                    <div>
                      <SegmentedChoice
                        label="Quality"
                        className="max-sm:w-full max-sm:*:flex-1 max-sm:*:px-0"
                        options={qualityOptions}
                        value={videoPreset}
                        disabled={download.isPending}
                        onValueChange={(preset) => {
                          setVideoPreset(preset);
                          download.reset();
                        }}
                      />
                      {rows.length > 1 ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Applies to {countLabel(videoLinks.length, "link")} saved as video.
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <span className="text-[12.5px] font-medium text-muted-foreground">Transcript</span>
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Switch
                    id="download-transcribe"
                    checked={transcribe}
                    disabled={download.isPending}
                    onCheckedChange={(checked) => {
                      setTranscribe(checked);
                      download.reset();
                    }}
                  />
                  <label htmlFor="download-transcribe">Transcribe after download</label>
                </div>
              </div>
            </>
          ) : null}
          {download.error ? (
            <p role="alert" className="mt-3 text-[13px]/5 wrap-anywhere text-destructive">
              {download.error.message}
            </p>
          ) : null}
        </div>
        <DialogFooter className="mt-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {skipped > 0
              ? `${countLabel(skipped, "link")} skipped.`
              : "Downloads run one at a time."}
          </p>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              aria-busy={download.isPending}
              disabled={!ready || queued.length === 0 || download.isPending}
              onClick={() =>
                download.mutate({
                  links: queued.flatMap(({ row, preset, preview }) =>
                    row.source
                      ? [
                          {
                            url: row.source.url,
                            preset,
                            ...(preview?.data ? { title: preview.data.title } : {}),
                          },
                        ]
                      : [],
                  ),
                  transcribe,
                })
              }
            >
              {download.isPending ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" aria-hidden="true" />
              )}
              {download.isPending
                ? "Adding…"
                : queued.length > 1
                  ? `Download ${queued.length}`
                  : "Download"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
