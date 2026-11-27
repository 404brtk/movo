import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import { useQuery } from "@tanstack/react-query";
import {
  currentChapterIndex,
  formatMoment,
  parseMoment,
  videoDescriptionChapters,
} from "../../shared/chapters.ts";
import type { Chapter, ChapterUpdate } from "../../shared/contracts/overview.ts";
import {
  createChapter,
  defaultModelOptions,
  deleteChapter,
  deleteChapters,
  overviewOptions,
  stopOverview,
  updateChapter,
  writeOverview,
} from "../lib/api.ts";
import { focusOnMount } from "../lib/match-stepper.ts";
import { useOverviewChange } from "../lib/overview.ts";
import { rowMenuTriggerClassName } from "../lib/row-menu.ts";
import { sourceSite } from "../lib/source-sites.ts";
import { copyFailureMessage } from "../lib/transcript-sharing.ts";
import { cn } from "../lib/utils.ts";
import { ConfirmDialog, ReplaceWithModelDialog } from "./confirm-dialog.tsx";
import { MenuIcon } from "./menu-icon.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

export interface ChapterContext {
  mediaId: string;
  durationMs: number;
  sourceUrl: string | null;
  positionMs: number | undefined;
  onSeek: ((milliseconds: number) => void) | undefined;
}

type Variant = "column" | "sheet";
type Draft = { id: string | null; startMs: number; time: string; title: string };

const variants = {
  column: {
    row: "-mx-2.5 min-h-8 w-[calc(100%+1.25rem)] rounded-lg px-2.5 py-[7px] text-[13px]/[18px]",
    time: "text-xs/[18px]",
    columns: (hours: boolean) => (hours ? "grid-cols-[64px_1fr]" : "grid-cols-[52px_1fr]"),
  },
  sheet: {
    row: "min-h-11 w-full rounded-[10px] px-3 py-3 text-[15px]/5",
    time: "text-[13px]/5",
    columns: (hours: boolean) => (hours ? "grid-cols-[72px_1fr]" : "grid-cols-[56px_1fr]"),
  },
} as const;

const rowSelector = "[data-chapter-row]";

function KeyHint({ children }: { children: string }) {
  return (
    <DropdownMenuShortcut aria-hidden="true" className="pointer-coarse:hidden">
      {children}
    </DropdownMenuShortcut>
  );
}

function ChapterEditor({
  draft,
  hours,
  variant,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  hours: boolean;
  variant: Variant;
  error: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const errorId = useId();
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSave();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) onSave();
  };
  return (
    <li>
      <div
        className={cn(
          "-mx-2.5 flex items-center gap-1.5 rounded-[10px] bg-subtle p-1",
          variant === "sheet" && "mx-0",
        )}
      >
        <Input
          aria-label="Chapter start"
          aria-invalid={error !== null || undefined}
          aria-describedby={error ? errorId : undefined}
          inputMode="numeric"
          value={draft.time}
          onKeyDown={handleKey}
          onBlur={handleBlur}
          className={cn("shrink-0 tabular-nums", hours ? "w-[68px]" : "w-[60px]")}
          onChange={(event) => onChange({ ...draft, time: event.target.value })}
        />
        <Input
          aria-label="Chapter title"
          placeholder="Chapter title"
          ref={focusOnMount}
          maxLength={120}
          value={draft.title}
          onKeyDown={handleKey}
          onBlur={handleBlur}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs/4 text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function ChapterList({
  context,
  variant = "column",
  onPicked,
  className,
}: {
  context: ChapterContext;
  variant?: Variant;
  onPicked?: () => void;
  className?: string;
}) {
  const { mediaId, durationMs, positionMs, onSeek } = context;
  const { add: addToast, close: closeToast } = Toast.useToastManager();
  const headingId = useId();
  const list = useRef<HTMLOListElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const overview = useQuery(overviewOptions(mediaId));
  const defaultModel = useQuery(defaultModelOptions);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const savingDraft = useRef(false);
  const [dialog, setDialog] = useState<"write" | "delete" | null>(null);
  const create = useOverviewChange(mediaId, (chapter: Parameters<typeof createChapter>[1]) =>
    createChapter(mediaId, chapter),
  );
  const update = useOverviewChange(
    mediaId,
    ({ id, change }: { id: string; change: ChapterUpdate }) => updateChapter(mediaId, id, change),
  );
  const remove = useOverviewChange(mediaId, (id: string) => deleteChapter(mediaId, id));
  const removeAll = useOverviewChange(mediaId, () => deleteChapters(mediaId));
  const write = useOverviewChange(mediaId, () => writeOverview(mediaId, "chapters"));
  const stop = useOverviewChange(mediaId, () => stopOverview(mediaId));
  const data = overview.data;
  if (!data) return null;
  const { chapters, chaptersSource } = data;
  const writing = data.writing?.scope === "all" || data.writing?.scope === "chapters";
  const chapterFailure = data.failure?.scope === "chapters" ? data.failure : null;
  if (
    variant === "column" &&
    chapters.length === 0 &&
    !writing &&
    !chapterFailure &&
    draft === null
  )
    return null;
  const style = variants[variant];
  const hours = chapters.some((chapter) => chapter.startMs >= 3_600_000);
  const current = positionMs === undefined ? -1 : currentChapterIndex(chapters, positionMs);
  const modelName = defaultModel.data?.modelName ?? null;
  const site =
    chaptersSource === "site" && context.sourceUrl ? sourceSite(context.sourceUrl) : null;
  const error =
    write.error ??
    stop.error ??
    removeAll.error ??
    (draft ? null : (remove.error ?? create.error)) ??
    null;

  const focusRow = (from: HTMLElement, step: number) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(rowSelector) ?? [])];
    rows[rows.indexOf(from) + step]?.focus();
  };
  const startEdit = (chapter: Chapter) => {
    if (savingDraft.current) return;
    setDraftError(null);
    setDraft({ ...chapter, time: formatMoment(chapter.startMs) });
  };
  const startNew = () => {
    if (savingDraft.current) return;
    setDraftError(null);
    const startMs = Math.round(positionMs ?? 0);
    setDraft({ id: null, startMs, time: formatMoment(startMs), title: "" });
  };
  const closeDraft = () => {
    setDraft(null);
    setDraftError(null);
  };
  const saveDraft = () => {
    if (!draft || savingDraft.current) return;
    const startMs = parseMoment(draft.time, draft.startMs);
    const title = draft.title.trim();
    const existing = chapters.find((chapter) => chapter.id === draft.id);
    if (!title && !existing) return closeDraft();
    if (startMs === null || startMs >= durationMs)
      return setDraftError("Enter a time like 1:05, inside the recording.");
    if (!title) return setDraftError("Give the chapter a title.");
    const done = {
      onSuccess: closeDraft,
      onError: (failure: Error) => setDraftError(failure.message),
      onSettled: () => {
        savingDraft.current = false;
      },
    };
    if (!existing) {
      savingDraft.current = true;
      return create.mutate({ startMs, title }, done);
    }
    const change = {
      ...(startMs === existing.startMs ? {} : { startMs }),
      ...(title === existing.title ? {} : { title }),
    };
    if (Object.keys(change).length === 0) return closeDraft();
    savingDraft.current = true;
    update.mutate({ id: existing.id, change }, done);
  };
  const removeChapter = (chapter: Chapter) =>
    remove.mutate(chapter.id, {
      onSuccess: () => {
        let restoring = false;
        const toastId = addToast({
          title: `Deleted “${chapter.title}”`,
          actionProps: {
            children: "Undo",
            onClick: () => {
              if (restoring) return;
              restoring = true;
              closeToast(toastId);
              create.mutate(chapter, {
                onError: (failure) =>
                  addToast({
                    title: "Could not restore the chapter",
                    description: failure.message,
                    priority: "high",
                  }),
              });
            },
          },
        });
      },
    });
  const copyChapters = () =>
    navigator.clipboard.writeText(videoDescriptionChapters(chapters)).then(
      () => addToast({ title: "Chapters copied" }),
      () =>
        addToast({
          title: "Could not copy the chapters",
          description: copyFailureMessage,
          priority: "high",
        }),
    );
  const seek = (startMs: number) => {
    onSeek?.(startMs);
    onPicked?.();
  };
  const rowKeys = (event: KeyboardEvent<HTMLButtonElement>, chapter: Chapter) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    }
    if (writing) return;
    if (event.key === "F2") {
      event.preventDefault();
      startEdit(chapter);
    }
    if (event.key === "Delete") {
      event.preventDefault();
      focusRow(event.currentTarget, 1);
      removeChapter(chapter);
    }
  };
  const draftRow = (key: string) =>
    draft ? (
      <ChapterEditor
        key={key}
        draft={draft}
        hours={hours}
        variant={variant}
        error={draftError}
        onChange={setDraft}
        onSave={saveDraft}
        onCancel={closeDraft}
      />
    ) : null;
  const draftStart = draft?.id === null ? (parseMoment(draft.time, draft.startMs) ?? 0) : null;
  const rows = chapters.flatMap((chapter, index) => {
    const before =
      draftStart !== null &&
      draftStart < chapter.startMs &&
      (index === 0 || draftStart >= (chapters[index - 1]?.startMs ?? 0))
        ? [draftRow("new")]
        : [];
    if (draft?.id === chapter.id) return [...before, draftRow(chapter.id)];
    const time = formatMoment(chapter.startMs);
    const isCurrent = index === current;
    return [
      ...before,
      <li key={chapter.id} className="group relative">
        <button
          type="button"
          data-chapter-row=""
          aria-current={isCurrent || undefined}
          aria-keyshortcuts={writing ? undefined : "F2 Delete"}
          className={cn(
            "grid cursor-pointer items-baseline text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            style.row,
            style.columns(hours),
            "pr-9",
            isCurrent ? "bg-tint" : "hover:bg-subtle",
          )}
          onClick={() => seek(chapter.startMs)}
          onKeyDown={(event) => rowKeys(event, chapter)}
        >
          <span
            className={cn(
              "tabular-nums",
              style.time,
              isCurrent ? "font-medium text-primary-strong" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          <span className={cn("text-pretty wrap-anywhere", isCurrent && "font-medium")}>
            {chapter.title}
          </span>
        </button>
        {!writing ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn("absolute top-0.5 right-0", rowMenuTriggerClassName)}
                />
              }
              aria-label={`Actions for ${chapter.title}`}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuItem onClick={() => seek(chapter.startMs)}>
                <MenuIcon icon={ArrowRight01Icon} />
                Jump to {time}
              </DropdownMenuItem>
              <DropdownMenuItem aria-keyshortcuts="F2" onClick={() => startEdit(chapter)}>
                <MenuIcon icon={Edit02Icon} />
                Edit chapter
                <KeyHint>F2</KeyHint>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                aria-keyshortcuts="Delete"
                className="mt-1"
                onClick={() => removeChapter(chapter)}
              >
                <MenuIcon icon={Delete02Icon} />
                Delete chapter
                <KeyHint>Del</KeyHint>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>,
    ];
  });
  const lastDraft =
    draftStart !== null && draftStart >= (chapters.at(-1)?.startMs ?? 0) ? [draftRow("new")] : [];
  return (
    <nav aria-labelledby={headingId} className={cn("flex min-h-0 flex-col", className)}>
      <div
        className={cn(
          "mb-1.5 flex h-7 shrink-0 items-center gap-1.5",
          variant === "sheet" ? "px-4" : "-mr-1.5",
        )}
      >
        <h2
          id={headingId}
          className={cn("font-semibold", variant === "sheet" ? "text-base/6" : "text-[13px]/5")}
        >
          Chapters
        </h2>
        {chapters.length > 0 && !writing ? (
          <span className="text-[13px] text-muted-foreground tabular-nums">{chapters.length}</span>
        ) : null}
        {site && !writing ? (
          <span className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
            {site.icon ? <HugeiconsIcon icon={site.icon} size={13} aria-hidden="true" /> : null}
            From {site.name}
          </span>
        ) : null}
        <span className="flex-1" />
        {data.writing?.scope === "chapters" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={stop.isPending}
            onClick={() => stop.mutate(undefined)}
          >
            Stop
          </Button>
        ) : null}
        {writing ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={menuTrigger}
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="Chapter actions"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[236px]">
              <DropdownMenuItem onClick={startNew}>
                <MenuIcon icon={Add01Icon} />
                Add chapter at {formatMoment(positionMs ?? 0)}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={chapters.length === 0}
                onClick={() => void copyChapters()}
              >
                <MenuIcon icon={Copy01Icon} />
                Copy for a video description
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={defaultModel.data === null}
                onClick={() => setDialog("write")}
              >
                <MenuIcon icon={RefreshIcon} />
                Write chapters again…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="mt-1"
                disabled={chapters.length === 0}
                onClick={() => setDialog("delete")}
              >
                <MenuIcon icon={Delete02Icon} />
                Delete all chapters…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {chapterFailure ? (
        <div role="alert" className="mb-2 text-xs/4 text-muted-foreground">
          <p>{chapterFailure.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={!modelName || write.isPending}
            onClick={() => setDialog("write")}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 text-xs/4 text-destructive">
          {error.message}
        </p>
      ) : null}
      {writing ? (
        <output aria-label="Writing chapters" className="grid">
          {["w-[62%]", "w-[78%]", "w-[52%]", "w-[70%]", "w-[60%]", "w-[46%]"].map((width) => (
            <span key={width} className="flex h-8 items-center gap-6">
              <Skeleton className="h-2.5 w-[30px] rounded-full motion-reduce:animate-none" />
              <Skeleton className={cn("h-2.5 rounded-full motion-reduce:animate-none", width)} />
            </span>
          ))}
        </output>
      ) : (
        <ol
          ref={list}
          className={cn(
            "-mt-1 min-h-0 overflow-y-auto overscroll-contain pt-1",
            variant === "column"
              ? "-mx-3.5 mask-[linear-gradient(#000_calc(100%-40px),transparent)] px-3.5 pb-10"
              : "px-1 pb-1",
          )}
        >
          {rows}
          {lastDraft}
        </ol>
      )}
      <ReplaceWithModelDialog
        open={dialog === "write"}
        onOpenChange={(open) => setDialog(open ? "write" : null)}
        title="Replace these chapters?"
        description={`${modelName ?? "The model"} writes new chapters from the current transcript. The ${chapters.length} chapters here are replaced. The summary stays as it is.`}
        confirm="Write new chapters"
        busy={write.isPending}
        onConfirm={() => write.mutate(undefined, { onSettled: () => setDialog(null) })}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        returnFocus={menuTrigger}
        icon={Delete02Icon}
        title="Delete all chapters?"
        description={`The ${chapters.length} chapters are removed from this recording. The summary and the transcript stay.`}
        keep="Cancel"
        confirm="Delete chapters"
        pending="Deleting…"
        busy={removeAll.isPending}
        error={removeAll.error?.message ?? null}
        severity="permanent"
        onConfirm={() => removeAll.mutate(undefined, { onSuccess: () => setDialog(null) })}
      />
    </nav>
  );
}
