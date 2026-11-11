import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { MoreHorizontalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import { canStartTranscription, describeMedia } from "../lib/library-view.ts";
import { useRenameRecording } from "../lib/recording-mutations.ts";
import { copyFailureMessage } from "../lib/transcript-sharing.ts";
import { useTranscriptionAction } from "../lib/transcription-actions.ts";
import { cn } from "../lib/utils.ts";
import { focusRecordingRow, useLibraryManagement } from "./library-management.tsx";
import { MediaRow } from "./media-row.tsx";
import { MediaThumbnail } from "./media-thumbnail.tsx";
import { useRecordingActions } from "./recording-actions.tsx";
import { Spinner } from "./spinner.tsx";
import { TranscriptionStatus } from "./transcription-status.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";
import { Kbd } from "./ui/kbd.tsx";

const withShift = (event: unknown) =>
  (event instanceof MouseEvent || event instanceof KeyboardEvent) && event.shiftKey;

const rowLinks = () => [...document.querySelectorAll<HTMLElement>("[data-row-link]")];

function neighbourRow(row: HTMLElement | null, step: 1 | -1) {
  const rows = rowLinks();
  const index = row ? rows.indexOf(row) : -1;
  return index < 0 ? null : (rows[index + step] ?? null);
}

function TitleField({
  item,
  onClose,
}: {
  item: LibraryItem;
  onClose: (restoreFocus: boolean) => void;
}) {
  const rename = useRenameRecording(item);
  const [draft, setDraft] = useState(item.title);
  const input = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const errorId = `rename-error-${item.id}`;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const close = (restoreFocus: boolean) => {
    closing.current = true;
    onClose(restoreFocus);
  };
  const save = (restoreFocus: boolean) => {
    const title = draft.trim();
    if (!title || title === item.title) return close(restoreFocus);
    rename.mutate(title, { onSuccess: () => close(restoreFocus) });
  };

  return (
    <form
      aria-label={`Rename ${item.title}`}
      className="relative z-10"
      onSubmit={(event) => {
        event.preventDefault();
        if (!rename.isPending) save(true);
      }}
    >
      <span className="-ml-2 flex items-center gap-2">
        <input
          ref={input}
          name="title"
          aria-label="Title"
          maxLength={512}
          value={draft}
          readOnly={rename.isPending}
          aria-busy={rename.isPending || undefined}
          aria-invalid={rename.isError || undefined}
          aria-describedby={rename.isError ? errorId : undefined}
          className="h-7 w-full min-w-0 rounded-[7px] border border-ring bg-background px-[7px] text-sm/5 font-medium shadow-[0_0_0_3px] shadow-ring/20 outline-none aria-invalid:border-destructive aria-invalid:shadow-destructive/15"
          onChange={(event) => {
            setDraft(event.target.value);
            if (rename.isError) rename.reset();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (!rename.isPending) close(true);
          }}
          onBlur={() => {
            if (!closing.current && !rename.isPending && !rename.isError) save(false);
          }}
        />
        {rename.isPending ? <Spinner /> : null}
      </span>
      {rename.isError ? (
        <p id={errorId} role="alert" className="mt-0.5 truncate text-xs text-destructive">
          {rename.error.message}
        </p>
      ) : (
        <p
          aria-hidden="true"
          className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground pointer-coarse:hidden"
        >
          <Kbd>Enter</Kbd> save <span className="px-0.5">·</span> <Kbd>Esc</Kbd> cancel
        </p>
      )}
    </form>
  );
}

function SelectionBox({ item, revealOnHover }: { item: LibraryItem; revealOnHover: boolean }) {
  const management = useLibraryManagement();
  const selecting = management.selected.size > 0;
  return (
    <span className="group/select relative z-10 grid w-11 shrink-0 place-items-center self-stretch">
      <MediaThumbnail
        item={item}
        className={cn(
          "col-start-1 row-start-1 transition-opacity duration-150",
          selecting
            ? "opacity-0"
            : cn(
                "group-has-focus-visible/select:opacity-0",
                revealOnHover && "pointer-fine:group-hover:opacity-0",
              ),
        )}
      />
      <Checkbox
        aria-label={`Select ${item.title}`}
        checked={management.selected.has(item.id)}
        tabIndex={selecting ? 0 : -1}
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
        onCheckedChange={(_checked, details) =>
          management.toggle(item.id, withShift(details.event))
        }
        className={cn(
          "col-start-1 row-start-1 transition-opacity duration-150 after:-inset-x-[13px] after:-inset-y-5",
          !selecting && "opacity-0 focus-visible:opacity-100",
          !selecting &&
            (revealOnHover
              ? "pointer-coarse:pointer-events-none pointer-fine:group-hover:opacity-100"
              : "pointer-events-none"),
        )}
      />
    </span>
  );
}

export function LibraryRow({
  item,
  title,
  detailed,
  offerTranscribe,
  className,
}: {
  item: LibraryItem;
  title?: ReactNode;
  detailed: boolean;
  offerTranscribe: boolean;
  className?: string;
}) {
  const management = useLibraryManagement();
  const transcribe = useTranscriptionAction(item.id);
  const [engaged, setEngaged] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rowLink = useRef<HTMLAnchorElement>(null);
  const actions = useRecordingActions({
    item,
    transcribe,
    loadTranscription:
      engaged && (item.transcription === "done" || item.transcription === "stopped"),
    returnFocus: rowLink,
    onRename: () => setRenaming(true),
    onDeleted: (deletion) => {
      const next = neighbourRow(rowLink.current, 1) ?? neighbourRow(rowLink.current, -1);
      if (deletion.cleanupError) management.reportCleanup(deletion.cleanupError);
      focusRecordingRow(next);
    },
    library: { onSelect: () => management.select(item.id) },
  });
  const offerTranscribeButton = offerTranscribe && canStartTranscription(item);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== rowLink.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = neighbourRow(rowLink.current, event.key === "ArrowDown" ? 1 : -1);
      if (!next) return;
      event.preventDefault();
      next.focus();
    } else if (event.key === "F2") {
      event.preventDefault();
      setRenaming(true);
    } else if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) {
      event.preventDefault();
      actions.confirmDelete();
    }
  };

  const details = transcribe.isError ? (
    <span role="alert" className="text-destructive">
      {transcribe.error.message}
    </span>
  ) : actions.copyState === "failed" ? (
    <span role="alert" className="text-destructive">
      {copyFailureMessage}
    </span>
  ) : actions.copyState === "copied" ? (
    <output className="inline-flex items-center gap-1 text-success">
      <HugeiconsIcon icon={Tick02Icon} aria-hidden="true" className="size-3.5" />
      Transcript copied
    </output>
  ) : (
    describeMedia(item, { detailed })
  );

  return (
    <>
      <ContextMenu disabled={renaming}>
        <ContextMenuTrigger
          render={
            <MediaRow
              item={item}
              linkRef={rowLink}
              title={title ?? item.title}
              details={details}
              data-selected={management.selected.has(item.id) || undefined}
              className={cn(
                "transition-colors hover:bg-subtle has-data-popup-open:bg-subtle data-popup-open:bg-subtle pointer-coarse:select-none data-selected:bg-tint data-selected:hover:bg-tint",
                className,
              )}
              onPointerEnter={() => setEngaged(true)}
              onFocus={() => setEngaged(true)}
              onKeyDown={handleKeyDown}
              leading={<SelectionBox item={item} revealOnHover={!renaming} />}
              editor={
                renaming ? (
                  <TitleField
                    item={item}
                    onClose={(restoreFocus) => {
                      setRenaming(false);
                      if (restoreFocus) requestAnimationFrame(() => rowLink.current?.focus());
                    }}
                  />
                ) : undefined
              }
              status={
                <>
                  {offerTranscribeButton ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-busy={transcribe.isPending}
                      disabled={transcribe.isPending}
                      onClick={() =>
                        transcribe.mutate(item.transcription === "stopped" ? "retry" : "start")
                      }
                    >
                      {transcribe.isPending ? <Spinner /> : null}
                      {transcribe.isPending ? "Starting…" : "Transcribe"}
                    </Button>
                  ) : (
                    <TranscriptionStatus transcription={item.transcription} />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label={`More actions for ${item.title}`}
                      disabled={actions.busy}
                      className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100 group-data-popup-open:opacity-100 group-data-selected:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
                    >
                      <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[236px]">
                      {actions.items}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          }
        />
        <ContextMenuContent className="w-[236px]">{actions.items}</ContextMenuContent>
      </ContextMenu>
      {actions.dialogs}
    </>
  );
}
