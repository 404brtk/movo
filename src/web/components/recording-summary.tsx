import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  Plug01Icon,
  RefreshIcon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatMoment, parseMoment, summaryGist, timedLines } from "../../shared/chapters.ts";
import {
  maxKeyPoints,
  type OverviewScope,
  type RecordingOverview,
  type RecordingSummary as Summary,
} from "../../shared/contracts/overview.ts";
import {
  defaultModelOptions,
  deleteSummary,
  editSummary,
  overviewOptions,
  stopOverview,
  writeOverview,
} from "../lib/api.ts";
import { formatDay } from "../lib/format.ts";
import { focusOnMount } from "../lib/match-stepper.ts";
import { useOverviewChange, useSummaryExpanded } from "../lib/overview.ts";
import { copyFailureMessage } from "../lib/transcript-sharing.ts";
import { cn } from "../lib/utils.ts";
import { ConfirmDialog, ReplaceWithModelDialog } from "./confirm-dialog.tsx";
import { MenuIcon } from "./menu-icon.tsx";
import { Spinner } from "./spinner.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

const leadClassName = "text-lg/7 tracking-[-0.012em] text-muted-foreground sm:text-xl/[31px]";
const revealOnHover =
  "transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/summary:opacity-100 [@media(hover:hover)]:group-focus-within/summary:opacity-100 [@media(hover:hover)]:group-has-data-popup-open/summary:opacity-100";

export interface SummaryContext {
  mediaId: string;
  durationMs: number;
  language: string | null;
  positionMs: number | undefined;
  onSeek: ((milliseconds: number) => void) | undefined;
}

const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const summaryText = (summary: Summary) =>
  [
    summary.text,
    ...(summary.keyPoints.length > 0 ? ["", "Key points", timedLines(summary.keyPoints)] : []),
  ].join("\n");

function SummaryLabel({ labelId, children }: { labelId: string; children?: ReactNode }) {
  return (
    <div className="mb-1.5 flex h-6 items-center gap-2 text-xs font-medium text-muted-foreground">
      <h2 id={labelId}>Summary</h2>
      <span className="flex-1" />
      {children}
    </div>
  );
}

function Lead({ text, language }: { text: string; language: string | null }) {
  const { gist, rest } = summaryGist(text, language);
  return (
    <p className={cn(leadClassName, "text-pretty wrap-anywhere whitespace-pre-line")}>
      <strong className="font-[550] text-foreground">{gist}</strong>
      {rest ? ` ${rest}` : null}
    </p>
  );
}

function Prompt({
  title,
  children,
  alert = false,
}: {
  title: string;
  children: ReactNode;
  alert?: boolean;
}) {
  return (
    <p
      role={alert ? "alert" : undefined}
      className={cn(leadClassName, "max-w-[36rem] text-pretty")}
    >
      {alert ? (
        <HugeiconsIcon
          icon={AlertCircleIcon}
          aria-hidden="true"
          className="mr-2 inline size-[18px] align-[-3px] text-destructive"
        />
      ) : null}
      <strong className="font-[550] text-foreground">{title}</strong> {children}
    </p>
  );
}

function useSummaryHeights() {
  const [heights, setHeights] = useState<{ preview: number; full: number; clipped: boolean }>();
  const measure = useCallback((element: HTMLDivElement | null) => {
    const lead = element?.firstElementChild;
    if (!element || !(lead instanceof HTMLParagraphElement)) return undefined;
    const update = () => {
      const leadHeight = lead.offsetHeight;
      const previewLimit = 3 * Number.parseFloat(getComputedStyle(lead).lineHeight);
      const preview = Math.min(leadHeight, previewLimit);
      const full = element.offsetHeight;
      const clipped = leadHeight > preview;
      setHeights((previous) =>
        previous?.preview === preview && previous.full === full && previous.clipped === clipped
          ? previous
          : { preview, full, clipped },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(lead);
    update();
    return () => observer.disconnect();
  }, []);
  return [heights, measure] as const;
}

function KeyPoints({
  summary,
  onSeek,
}: {
  summary: Summary;
  onSeek: ((milliseconds: number) => void) | undefined;
}) {
  if (summary.keyPoints.length === 0) return null;
  return (
    <div className="pt-5 pb-1">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Key points</h3>
      <ul>
        {summary.keyPoints.map((point) => {
          const time = formatMoment(point.startMs);
          const content = (
            <>
              <span className="text-xs/5 text-muted-foreground tabular-nums">{time}</span>
              <span className="text-base/6 text-pretty wrap-anywhere">{point.text}</span>
            </>
          );
          const rowClassName =
            "-mx-3.5 grid w-[calc(100%+1.75rem)] grid-cols-[52px_1fr] items-baseline rounded-[10px] px-3.5 py-[7px] text-left";
          return (
            <li key={point.startMs}>
              {onSeek ? (
                <button
                  type="button"
                  aria-label={`Jump to ${time}, ${point.text}`}
                  className={cn(
                    rowClassName,
                    "cursor-pointer transition-colors duration-150 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                  onClick={() => onSeek(point.startMs)}
                >
                  {content}
                </button>
              ) : (
                <div className={rowClassName}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SummaryBody({
  summary,
  language,
  onSeek,
  footer,
}: {
  summary: Summary;
  language: string | null;
  onSeek: ((milliseconds: number) => void) | undefined;
  footer?: ReactNode;
}) {
  const [expanded, setExpanded] = useSummaryExpanded();
  const [animate, setAnimate] = useState(false);
  const [heights, measure] = useSummaryHeights();
  const pointsPanel = useRef<HTMLDivElement>(null);
  const points = summary.keyPoints.length;
  const expandable = heights?.clipped || points > 0 || expanded;
  const panelId = useId();
  return (
    <>
      <div
        id={panelId}
        className={cn(
          "relative -mx-5 overflow-hidden",
          animate &&
            (expanded
              ? "motion-safe:[transition:height_220ms_var(--ease-snappy)]"
              : "motion-safe:[transition:height_180ms_var(--ease-snappy)]"),
        )}
        style={heights && { height: expanded ? heights.full : heights.preview }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setAnimate(false);
        }}
      >
        <div ref={measure} className="px-5">
          <Lead text={summary.text} language={language} />
          <div ref={pointsPanel} inert={!expanded}>
            <KeyPoints summary={summary} onSeek={onSeek} />
          </div>
        </div>
        {heights?.clipped ? (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-5 bottom-0 h-10 bg-linear-to-b from-transparent to-background",
              expanded && "opacity-0",
              animate && "motion-safe:[transition:opacity_120ms_var(--ease-snappy)]",
            )}
          />
        ) : null}
      </div>
      {expandable || footer ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {expandable ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              aria-controls={panelId}
              className="-ml-2.5 aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground"
              onClick={(event) => {
                setAnimate(event.detail > 0 && heights?.preview !== heights?.full);
                setExpanded(!expanded);
                if (!expanded && event.detail === 0)
                  requestAnimationFrame(() =>
                    pointsPanel.current?.querySelector("button")?.focus(),
                  );
              }}
            >
              {expanded ? "Show less" : "Read more"}
              {!expanded && points > 0 ? (
                <span className="font-normal opacity-85">· {countLabel(points, "key point")}</span>
              ) : null}
              <HugeiconsIcon
                icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
                aria-hidden="true"
                className="size-3.5"
              />
            </Button>
          ) : null}
          {footer}
        </div>
      ) : null}
    </>
  );
}

function WritingState({ writing }: { writing: NonNullable<RecordingOverview["writing"]> }) {
  return (
    <>
      <output className="flex items-center gap-2 text-[13px]/5 text-muted-foreground">
        <Spinner />
        {writing.part !== null && writing.parts !== null
          ? `Reading the whole transcript, part ${writing.part} of ${writing.parts}`
          : "Writing the summary"}
      </output>
      <div aria-hidden="true" className="mt-2 grid gap-[17px] py-2">
        {["w-[92%]", "w-full", "w-[58%]"].map((width) => (
          <Skeleton
            key={width}
            className={cn("h-3.5 rounded-full motion-reduce:animate-none", width)}
          />
        ))}
      </div>
    </>
  );
}

type DraftPoint = { key: number; startMs: number; time: string; text: string };

function SummaryEditor({
  context,
  summary,
  onClose,
}: {
  context: SummaryContext;
  summary: Summary | null;
  onClose: () => void;
}) {
  const save = useOverviewChange(context.mediaId, (edit: Parameters<typeof editSummary>[1]) =>
    editSummary(context.mediaId, edit),
  );
  const nextKey = useRef(summary?.keyPoints.length ?? 0);
  const [text, setText] = useState(summary?.text ?? "");
  const [points, setPoints] = useState<DraftPoint[]>(
    () =>
      summary?.keyPoints.map((point, key) => ({
        key,
        startMs: point.startMs,
        time: formatMoment(point.startMs),
        text: point.text,
      })) ?? [],
  );
  const [invalid, setInvalid] = useState<ReadonlySet<number>>(new Set());
  const hintId = useId();
  const errorId = useId();
  const parsedTime = (point: DraftPoint) => {
    const startMs = parseMoment(point.time, point.startMs);
    return startMs !== null && startMs < context.durationMs ? startMs : null;
  };
  const submit = () => {
    const kept = points.filter((point) => point.text.trim());
    const wrong = new Set(
      kept.filter((point) => parsedTime(point) === null).map((point) => point.key),
    );
    setInvalid(wrong);
    if (wrong.size > 0 || !text.trim()) return;
    save.mutate(
      {
        text: text.trim(),
        keyPoints: kept.map((point) => ({
          startMs: parsedTime(point) ?? 0,
          text: point.text.trim().replace(/\s+/gu, " "),
        })),
      },
      { onSuccess: onClose },
    );
  };
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };
  const update = (key: number, change: Partial<DraftPoint>) =>
    setPoints(points.map((point) => (point.key === key ? { ...point, ...change } : point)));
  const error =
    invalid.size > 0
      ? "Enter each key point time like 1:05, inside the recording."
      : !text.trim()
        ? "Write a summary, or delete it from the menu."
        : (save.error?.message ?? null);
  return (
    <form
      aria-label="Edit summary"
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        aria-label="Summary"
        aria-describedby={hintId}
        ref={focusOnMount}
        value={text}
        onKeyDown={handleKey}
        className="-mx-3.5 field-sizing-content min-h-[93px] resize-none rounded-xl bg-background px-3.5 py-1.5 text-xl/[31px] tracking-[-0.012em] text-foreground shadow-editor outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
        onChange={(event) => setText(event.target.value)}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        The first sentence is shown in bold as the gist.
      </p>
      <fieldset className="mt-3 grid gap-1.5">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Key points</legend>
        {points.map((point, index) => (
          <div key={point.key} className="flex items-center gap-1.5">
            <Input
              onKeyDown={handleKey}
              aria-label={`Key point ${index + 1} time`}
              aria-invalid={invalid.has(point.key) || undefined}
              aria-describedby={invalid.has(point.key) ? errorId : undefined}
              inputMode="numeric"
              value={point.time}
              className="w-16 shrink-0 tabular-nums"
              onChange={(event) => update(point.key, { time: event.target.value })}
            />
            <Input
              onKeyDown={handleKey}
              aria-label={`Key point ${index + 1}`}
              value={point.text}
              maxLength={300}
              onChange={(event) => update(point.key, { text: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove key point ${index + 1}`}
              onClick={() => setPoints(points.filter((entry) => entry.key !== point.key))}
            >
              <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
            </Button>
          </div>
        ))}
        {points.length < maxKeyPoints ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5 w-fit"
            onClick={() => {
              const startMs = Math.round(context.positionMs ?? 0);
              setPoints([
                ...points,
                { key: nextKey.current++, startMs, time: formatMoment(startMs), text: "" },
              ]);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" aria-hidden="true" />
            Add key point at {formatMoment(context.positionMs ?? 0)}
          </Button>
        ) : null}
      </fieldset>
      {error && (invalid.size > 0 || save.isError) ? (
        <p id={errorId} role="alert" className="text-[13px]/5 text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? <Spinner /> : null}
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground pointer-coarse:hidden">
          Ctrl+Enter saves · Esc cancels
        </span>
      </div>
    </form>
  );
}

export function RecordingSummary({ context }: { context: SummaryContext }) {
  const { mediaId } = context;
  const { add: addToast } = Toast.useToastManager();
  const labelId = useId();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const overview = useQuery(overviewOptions(mediaId));
  const defaultModel = useQuery(defaultModelOptions);
  const write = useOverviewChange(mediaId, (scope: OverviewScope) => writeOverview(mediaId, scope));
  const stop = useOverviewChange(mediaId, () => stopOverview(mediaId));
  const remove = useOverviewChange(mediaId, () => deleteSummary(mediaId));
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"write" | "delete" | null>(null);
  const data = overview.data;
  if (!data) return null;
  const { summary, chapters, stale } = data;
  const failure = data.failure?.scope === "chapters" ? null : data.failure;
  const writing = data.writing && data.writing.scope !== "chapters" ? data.writing : null;
  const modelName = defaultModel.data?.modelName ?? null;
  const noModel = defaultModel.isSuccess && defaultModel.data === null;
  const startScope: OverviewScope = chapters.length > 0 ? "summary" : "all";
  const writeError = write.error ?? stop.error;
  const copy = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summaryText(summary)).then(
      () => addToast({ title: "Summary copied" }),
      () =>
        addToast({
          title: "Could not copy the summary",
          description: copyFailureMessage,
          priority: "high",
        }),
    );
  };
  const writeAgain = () => {
    if (summary?.source === "edited") setDialog("write");
    else write.mutate("summary");
  };
  const section = (content: ReactNode, label?: ReactNode) => (
    <section aria-labelledby={labelId} className="group/summary pt-2 pb-3">
      <SummaryLabel labelId={labelId}>{label}</SummaryLabel>
      {content}
    </section>
  );
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => menuTrigger.current?.focus());
  };
  if (editing)
    return section(<SummaryEditor context={context} summary={summary} onClose={closeEditor} />);
  if (writing)
    return section(
      <WritingState writing={writing} />,
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2.5"
        disabled={stop.isPending}
        onClick={() => stop.mutate(undefined)}
      >
        Stop
      </Button>,
    );
  const failureLine = failure ? (
    <div role="alert" className={cn("grid grid-cols-[16px_1fr] gap-x-2.5", summary && "mt-4")}>
      <HugeiconsIcon
        icon={AlertCircleIcon}
        aria-hidden="true"
        className="mt-0.5 size-4 text-destructive"
      />
      <p className="text-[15px]/6 text-pretty text-muted-foreground">
        <strong className="font-semibold text-foreground">Unable to write the summary.</strong>{" "}
        {failure.message}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="col-start-2 mt-3 w-fit"
        disabled={write.isPending || noModel}
        onClick={() =>
          summary ? writeAgain() : write.mutate(failure.scope === "all" ? startScope : "summary")
        }
      >
        <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden="true" />
        Try again
      </Button>
    </div>
  ) : null;
  const inlineError = writeError ? (
    <p role="alert" className="mt-3 text-[13px]/5 text-destructive">
      {writeError.message}
    </p>
  ) : null;
  if (!summary) {
    const jump = context.onSeek ? " you can jump to" : "";
    const kept =
      chapters.length > 0
        ? ` The ${countLabel(chapters.length, "chapter")} here stay as they are.`
        : "";
    const actionClassName = "mt-3";
    const content = noModel ? (
      <>
        <Prompt title="No summary yet.">
          Connect a model in Settings to write the main points, key moments and chapters of this
          recording.
        </Prompt>
        <Link
          to="/settings"
          hash="ask"
          className={buttonVariants({ variant: "outline", size: "sm", className: actionClassName })}
        >
          <HugeiconsIcon icon={Plug01Icon} data-icon="inline-start" aria-hidden="true" />
          Connect a model
        </Link>
      </>
    ) : failure ? (
      <>
        <Prompt title="Unable to write the summary." alert>
          {failure.message}
        </Prompt>
        <Button
          variant="outline"
          size="sm"
          className={actionClassName}
          disabled={write.isPending}
          aria-busy={write.isPending}
          onClick={() => write.mutate(failure.scope === "all" ? startScope : "summary")}
        >
          {write.isPending ? (
            <Spinner />
          ) : (
            <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden="true" />
          )}
          Try again
        </Button>
      </>
    ) : (
      <>
        <Prompt title="No summary yet.">
          {chapters.length > 0
            ? `A few sentences on what this recording is about, with key points${jump}.${kept}`
            : `A few sentences on what this recording is about, with key points and chapters${jump}.`}
        </Prompt>
        <Button
          variant="outline"
          size="sm"
          className={actionClassName}
          aria-busy={write.isPending}
          disabled={write.isPending || defaultModel.isPending}
          onClick={() => write.mutate(startScope)}
        >
          {write.isPending ? (
            <Spinner />
          ) : (
            <HugeiconsIcon icon={TextAlignLeftIcon} data-icon="inline-start" aria-hidden="true" />
          )}
          {chapters.length > 0 ? "Write summary" : "Write summary and chapters"}
        </Button>
      </>
    );
    return section(
      <div className="pb-1">
        {content}
        {inlineError}
      </div>,
      noModel || !modelName ? null : (
        <Link
          to="/settings"
          hash="ask"
          aria-label={`${modelName}, change the model in Settings`}
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "-mr-2 h-6 rounded-md px-2 text-xs font-normal",
          })}
        >
          {modelName}
        </Link>
      ),
    );
  }
  const meta =
    summary.source === "edited"
      ? `Edited by you · ${formatDay(summary.updatedAt)}`
      : `${summary.modelName ?? "Model"} · ${formatDay(summary.updatedAt)}`;
  return (
    <>
      {section(
        <>
          <SummaryBody
            summary={summary}
            language={context.language}
            onSeek={context.onSeek}
            footer={
              stale ? (
                <div className="ml-auto flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                    {stale.changes === null
                      ? "The transcript was transcribed again"
                      : `Transcript changed in ${countLabel(stale.changes, "place")}`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={write.isPending || noModel}
                    onClick={writeAgain}
                  >
                    <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden="true" />
                    Update
                  </Button>
                </div>
              ) : null
            }
          />
          {failureLine}
          {inlineError}
        </>,
        <div className={cn("flex items-center gap-2", revealOnHover)}>
          <span className="font-normal">{meta}</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={menuTrigger}
              render={<Button variant="ghost" size="icon-sm" className="-mr-1.5" />}
              aria-label="Summary actions"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[208px]">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <MenuIcon icon={Edit02Icon} />
                Edit summary
              </DropdownMenuItem>
              <DropdownMenuItem disabled={noModel} onClick={writeAgain}>
                <MenuIcon icon={RefreshIcon} />
                Write again…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copy}>
                <MenuIcon icon={Copy01Icon} />
                Copy summary
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="mt-1"
                onClick={() => setDialog("delete")}
              >
                <MenuIcon icon={Delete02Icon} />
                Delete summary…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>,
      )}
      <ReplaceWithModelDialog
        open={dialog === "write"}
        onOpenChange={(open) => setDialog(open ? "write" : null)}
        title="Replace your edited summary?"
        description={`${modelName ?? "The model"} writes a new summary and key points from the current transcript. Your edits to the summary are replaced. Chapters stay as they are.`}
        confirm="Write new summary"
        busy={write.isPending}
        onConfirm={() => write.mutate("summary", { onSuccess: () => setDialog(null) })}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        returnFocus={menuTrigger}
        icon={Delete02Icon}
        title="Delete the summary?"
        description={`The summary${summary.keyPoints.length > 0 ? ` and its ${countLabel(summary.keyPoints.length, "key point")}` : ""} ${summary.keyPoints.length > 0 ? "are" : "is"} removed from this recording. Chapters and the transcript stay. You can write a new summary later.`}
        keep="Cancel"
        confirm="Delete summary"
        pending="Deleting…"
        busy={remove.isPending}
        error={remove.error?.message ?? null}
        severity="permanent"
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setDialog(null) })}
      />
    </>
  );
}
