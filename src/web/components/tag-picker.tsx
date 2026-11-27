import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  maxTagNameCharacters,
  maxTags,
  tagColors,
  type Tag,
  type TagColor,
} from "../../shared/contracts/tags.ts";
import { leastUsedColor, tagNameKey, tagNameMatches } from "../../shared/tag-names.ts";
import { tagsOptions } from "../lib/api.ts";
import { recordingCount } from "../lib/library-selection.ts";
import { tagColorNames, tagMatchRanges, type TagState, useTagEditing } from "../lib/tags.ts";
import { cn } from "../lib/utils.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { MenuIcon } from "./menu-icon.tsx";
import { Spinner } from "./spinner.tsx";
import { TagOrb } from "./tag-chip.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Kbd } from "./ui/kbd.tsx";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

export const tagRowClassName =
  "group/tag relative flex h-[30px] cursor-default items-center gap-2 rounded-md pr-1 pl-1.5 outline-none select-none data-highlighted:bg-linear-to-b data-highlighted:from-primary-from data-highlighted:to-primary-to data-highlighted:text-primary-foreground data-highlighted:shadow-[inset_0_0_1px_1px_oklch(1_0_0/0.25)]";

type Row =
  | { kind: "tag"; tag: Tag; state: TagState; detail: string | null; disabled: boolean }
  | { kind: "create"; name: string; color: TagColor };

const rowKey = (row: Row) => (row.kind === "tag" ? row.tag.id : "create");
const rowLabel = (row: Row) => (row.kind === "tag" ? row.tag.name : row.name);

export interface TagPanelProps {
  placeholder: string;
  label?: string;
  stateOf: (tag: Tag) => TagState;
  detailOf?: (tag: Tag) => string | null;
  onToggle: (tag: Tag, state: TagState) => void;
  onCreate?: (tag: Tag) => void;
  full?: boolean;
  footer?: ReactNode;
  manage?: boolean;
  emptyMessage?: string;
}

export function MatchedName({ name, query }: { name: string; query: string }) {
  const parts: ReactNode[] = [];
  let shown = 0;
  for (const range of tagMatchRanges(name, query)) {
    parts.push(
      name.slice(shown, range.start),
      <b key={range.start} className="font-semibold">
        {name.slice(range.start, range.end)}
      </b>,
    );
    shown = range.end;
  }
  parts.push(name.slice(shown));
  return parts;
}

function ColourItem({ color }: { color: TagColor }) {
  return (
    <MenuPrimitive.RadioItem
      value={color}
      closeOnClick={false}
      aria-label={tagColorNames[color]}
      className="group/colour grid size-[26px] cursor-default place-items-center rounded-full outline-none data-highlighted:bg-muted"
    >
      <span
        data-tag-color={color}
        className="size-3.5 tag-orb [--tag-orb-ring:transparent] group-data-checked/colour:shadow-[0_0_0_2px_var(--popover),0_0_0_3.5px_oklch(0.6_calc(0.18*var(--tag-chroma))_var(--tag-hue))]"
      />
    </MenuPrimitive.RadioItem>
  );
}

function TagActions({
  tag,
  open,
  onOpenChange,
  onRename,
  onRecolour,
  onDelete,
}: {
  tag: Tag;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onRecolour: (color: TagColor) => void;
  onDelete: () => void;
}) {
  const movingFocus = useRef(false);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) movingFocus.current = false;
        onOpenChange(next);
      }}
    >
      <DropdownMenuTrigger
        aria-label={`Options for ${tag.name}`}
        aria-keyshortcuts="ArrowRight"
        tabIndex={-1}

        className="absolute top-[3px] right-1 grid size-6 shrink-0 cursor-default place-items-center rounded-[6px] text-muted-foreground opacity-0 outline-none group-hover/tag:opacity-100 group-has-[[data-highlighted]]/tag:text-primary-foreground group-has-[[data-highlighted]]/tag:opacity-100 hover:bg-muted-foreground/10 group-has-[[data-highlighted]]/tag:hover:bg-white/15 data-popup-open:opacity-100 pointer-coarse:opacity-100"
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        finalFocus={() => !movingFocus.current}
        align="start"
        side="right"
        sideOffset={6}
        className="w-[236px] motion-reduce:animate-none"
      >
        <DropdownMenuItem
          onClick={() => {
            movingFocus.current = true;
            onRename();
          }}
        >
          <MenuIcon icon={Edit02Icon} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Colour</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={tag.color}
            onValueChange={(value: TagColor) => onRecolour(value)}
            className="flex items-center justify-between px-1 pb-1"
          >
            {tagColors.map((color) => (
              <ColourItem key={color} color={color} />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            movingFocus.current = true;
            onDelete();
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
          Delete tag…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameField({ tag, onClose }: { tag: Tag; onClose: () => void }) {
  const { update } = useTagEditing();
  const [draft, setDraft] = useState(tag.name);
  const input = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const errorId = useId();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const close = () => {
    closing.current = true;
    onClose();
  };
  const save = () => {
    const name = draft.trim();
    if (!name || name === tag.name) return close();
    update.mutate({ id: tag.id, change: { name } }, { onSuccess: close });
  };
  return (
    <div className="px-1.5 py-1">
      <div className="flex items-center gap-2">
        <TagOrb tag={tag} />
        <input
          ref={input}
          aria-label={`New name for ${tag.name}`}
          maxLength={maxTagNameCharacters}
          value={draft}
          readOnly={update.isPending}
          aria-invalid={update.isError || undefined}
          aria-describedby={update.isError ? errorId : undefined}
          className="h-7 w-full min-w-0 rounded-[7px] border border-ring bg-background px-[7px] text-[13px] shadow-[0_0_0_3px] shadow-ring/20 outline-none aria-invalid:border-destructive aria-invalid:shadow-destructive/15"
          onChange={(event) => {
            setDraft(event.target.value);
            if (update.isError) update.reset();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              if (!update.isPending) save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              if (!update.isPending) close();
            }
          }}
          onBlur={() => {
            if (!closing.current && !update.isPending && !update.isError) save();
          }}
        />
        {update.isPending ? <Spinner /> : null}
      </div>
      {update.isError ? (
        <p id={errorId} role="alert" className="mt-1 pl-6 text-xs/4 text-destructive">
          {update.error.message}
        </p>
      ) : (
        <p
          aria-hidden="true"
          className="mt-1 flex items-center gap-1 pl-6 text-xs text-muted-foreground pointer-coarse:hidden"
        >
          <Kbd>Enter</Kbd>
          <span className="mr-2">save</span>
          <Kbd>Esc</Kbd>
          <span>cancel</span>
        </p>
      )}
    </div>
  );
}

export function TagPanel({
  placeholder,
  label,
  stateOf,
  detailOf,
  onToggle,
  onCreate,
  full = false,
  footer,
  manage = false,
  emptyMessage = "No tags yet",
}: TagPanelProps) {
  const tags = useQuery(tagsOptions);
  const { create, update, remove } = useTagEditing();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<Row | undefined>(undefined);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const all = tags.data ?? [];
  const typed = query.trim();
  const exact = all.some((tag) => tagNameKey(tag.name) === tagNameKey(typed));
  const [order, setOrder] = useState<readonly string[]>([]);
  const rank = new Map(order.map((id, index) => [id, index]));
  const added = all.filter((tag) => !rank.has(tag.id));
  if (added.length > 0) setOrder([...order, ...added.map((tag) => tag.id)]);
  const ordered = all.toSorted(
    (a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length),
  );
  const tagRows = ordered.map((tag): Row => ({
    kind: "tag",
    tag,
    state: stateOf(tag),
    detail: detailOf?.(tag) ?? null,
    disabled: full && stateOf(tag) === "none",
  }));
  const createRow: Row[] =
    onCreate && typed && !exact && !full && all.length < maxTags
      ? [
          {
            kind: "create",
            name: typed.slice(0, maxTagNameCharacters),
            color: leastUsedColor(all.map((tag) => tag.color)),
          },
        ]
      : [];
  const rows = [
    ...tagRows.filter((row) => row.kind === "tag" && tagNameMatches(row.tag.name, typed)),
    ...createRow,
  ];
  const chosen = tagRows.filter((row) => row.kind === "tag" && row.state === "all");

  const choose = (row: Row) => {
    if (row.kind === "tag") {
      if (!row.disabled) onToggle(row.tag, row.state);
      return;
    }
    if (create.isPending) return;
    create.mutate(
      { name: row.name },
      {
        onSuccess: (tag) => {
          setQuery("");
          onCreate?.(tag);
        },
      },
    );
  };

  const confirmDelete = (tag: Tag) => {
    if (tag.recordingCount === 0) remove.mutate(tag.id);
    else {
      remove.reset();
      setDeleting(tag);
    }
  };

  return (
    <Combobox.Root
      inline
      open
      multiple
      items={rows}
      filteredItems={rows}
      filter={null}
      value={chosen}
      isItemEqualToValue={(item, value) => rowKey(item) === rowKey(value)}
      itemToStringLabel={rowLabel}
      inputValue={query}
      onInputValueChange={(value, details) => {
        if (details.isItemPress) {
          details.cancel();
          return;
        }
        setQuery(value);
        create.reset();
      }}
      onValueChange={(next) => {
        const nextKeys = new Set(next.map(rowKey));
        const chosenKeys = new Set(chosen.map(rowKey));
        for (const row of [
          ...next.filter((each) => !chosenKeys.has(rowKey(each))),
          ...chosen.filter((each) => !nextKeys.has(rowKey(each))),
        ])
          choose(row);
      }}
      onItemHighlighted={(row) => setHighlighted(row)}
      autoHighlight
    >
      <div className="flex h-8 shrink-0 items-center gap-2 rounded-[9px] bg-muted px-2.5 text-muted-foreground shadow-well">
        <HugeiconsIcon icon={Search01Icon} className="size-3.5 shrink-0" aria-hidden="true" />
        <Combobox.Input
          ref={search}
          onKeyDown={(event) => {
            const input = event.currentTarget;
            if (
              manage &&
              event.key === "ArrowRight" &&
              highlighted?.kind === "tag" &&
              input.selectionStart === input.value.length
            ) {
              event.preventDefault();
              setActionsFor(highlighted.tag.id);
            }
          }}
          aria-label={placeholder}
          placeholder={placeholder}
          maxLength={maxTagNameCharacters}
          className="h-full w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-[13px]"
        />
      </div>
      {label ? <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{label}</p> : null}
      <Combobox.List
        aria-label={label ?? "Tags"}
        className={cn(
          "max-h-[min(296px,var(--available-height,296px))] overflow-y-auto overscroll-contain empty:hidden",
          !label && "pt-1",
        )}
      >
        {(row: Row) =>
          row.kind === "tag" && renaming === row.tag.id ? (
            <RenameField
              key={row.tag.id}
              tag={row.tag}
              onClose={() => {
                setRenaming(null);
                requestAnimationFrame(() => search.current?.focus());
              }}
            />
          ) : (
            <div key={rowKey(row)} className="group/tag relative">
              <Combobox.Item
                value={row}
                disabled={row.kind === "tag" && row.disabled}
                aria-checked={row.kind === "tag" && row.state === "some" ? "mixed" : undefined}
                className={cn(
                  tagRowClassName,
                  manage && row.kind === "tag" && "pr-8",
                  "data-disabled:opacity-45",
                )}
              >
                {row.kind === "create" ? (
                  <>
                    <span className="grid size-4 place-items-center">
                      {create.isPending ? (
                        <Spinner />
                      ) : (
                        <HugeiconsIcon
                          icon={Add01Icon}
                          strokeWidth={2}
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">Create “{row.name}”</span>
                    <TagOrb tag={row} className="mr-1" />
                  </>
                ) : (
                  <>
                    <TagOrb tag={row.tag} state={row.state} />
                    <span className="min-w-0 flex-1 truncate">
                      <MatchedName name={row.tag.name} query={typed} />
                    </span>
                    {row.detail ? (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-data-highlighted/tag:text-primary-foreground/85">
                        {row.detail}
                      </span>
                    ) : null}
                  </>
                )}
              </Combobox.Item>
              {manage && row.kind === "tag" ? (
                <TagActions
                  tag={row.tag}
                  open={actionsFor === row.tag.id}
                  onOpenChange={(open) => setActionsFor(open ? row.tag.id : null)}
                  onRename={() => setRenaming(row.tag.id)}
                  onRecolour={(color) => update.mutate({ id: row.tag.id, change: { color } })}
                  onDelete={() => confirmDelete(row.tag)}
                />
              ) : null}
            </div>
          )
        }
      </Combobox.List>
      <Combobox.Empty>
        {tags.isPending ? (
          <p className="flex h-[30px] items-center gap-2 px-2 text-muted-foreground">
            <Spinner />
            Loading tags…
          </p>
        ) : tags.isError ? (
          <p role="alert" className="px-2 py-1.5 text-xs/4 text-destructive">
            {tags.error.message}
          </p>
        ) : (
          <p className="px-2 py-1.5 text-muted-foreground">
            {typed ? `No tag named “${typed}”` : emptyMessage}
          </p>
        )}
      </Combobox.Empty>
      {create.isError || remove.isError || update.isError ? (
        <p role="alert" className="px-2 pt-1 pb-1.5 text-xs/4 text-destructive">
          {(create.error ?? (deleting ? null : remove.error) ?? update.error)?.message}
        </p>
      ) : null}
      {footer}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        returnFocus={search}
        icon={Delete02Icon}
        title={`Delete tag “${deleting?.name ?? ""}”?`}
        description={`It will be removed from ${recordingCount(deleting?.recordingCount ?? 0)}. The recordings stay in your library.`}
        keep="Cancel"
        confirm="Delete tag"
        pending="Deleting…"
        busy={remove.isPending}
        error={deleting ? (remove.error?.message ?? null) : null}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </Combobox.Root>
  );
}
