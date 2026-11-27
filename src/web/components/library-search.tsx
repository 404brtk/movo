import { useCallback, useEffect, useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Cancel01Icon, Search01Icon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { maxSearchLength, type LibraryQuery } from "../../shared/contracts/library.ts";
import { maxTagsPerRecording, tagIdList, tagIdsIn, type Tag } from "../../shared/contracts/tags.ts";
import { tagNameMatches } from "../../shared/tag-names.ts";
import { tagsOptions } from "../lib/api.ts";
import { useSearchDraft } from "../lib/search-draft.ts";
import { cn } from "../lib/utils.ts";
import { TagChip, TagOrb } from "./tag-chip.tsx";
import { MatchedName, TagPanel, tagRowClassName } from "./tag-picker.tsx";
import { TagPopover } from "./tag-popovers.tsx";
import { InputGroupButton } from "./ui/input-group.tsx";
import { Kbd } from "./ui/kbd.tsx";

const typedTag = /(?:^|\s)#(\S*)$/u;
const withoutTypedTag = (draft: string) => draft.replace(typedTag, "").trim() || undefined;
const sameTag = (first: Tag, second: Tag) => first.id === second.id;
const tagName = (tag: Tag) => tag.name;

function TagFilterMenu({
  chosenIds,
  onChange,
}: {
  chosenIds: readonly string[];
  onChange: (ids: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <TagPopover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label="Filter by tags"
      trigger={
        <InputGroupButton
          size="sm"
          className={cn(
            "h-7 gap-1.5 rounded-[7px] px-2 text-[13px] font-medium text-muted-foreground hover:bg-input/50 hover:text-foreground aria-expanded:bg-input/60 aria-expanded:text-foreground",
            chosenIds.length > 0 && "text-foreground",
          )}
        >
          <HugeiconsIcon icon={Tag01Icon} className="size-4" aria-hidden="true" />
          Tags
        </InputGroupButton>
      }
    >
      <TagPanel
        placeholder="Find a tag"
        label="Recordings with all of"
        full={chosenIds.length >= maxTagsPerRecording}
        emptyMessage="No tags yet"
        stateOf={(tag) => (chosenIds.includes(tag.id) ? "all" : "none")}
        onToggle={(tag, state) =>
          onChange(
            state === "all" ? chosenIds.filter((id) => id !== tag.id) : [...chosenIds, tag.id],
          )
        }
        footer={
          chosenIds.length > 0 ? (
            <button
              type="button"
              className="mt-0.5 flex h-[30px] w-full cursor-default items-center rounded-md px-2 text-left text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              Clear tags
            </button>
          ) : null
        }
      />
    </TagPopover>
  );
}

export function LibrarySearch({ search }: { search: LibraryQuery }) {
  const navigate = useNavigate({ from: "/" });
  const input = useRef<HTMLInputElement>(null);
  const tags = useQuery(tagsOptions);
  const allTags = tags.data ?? [];
  const chosenIds = tagIdsIn(search.tags);
  const chosen = allTags.filter((tag) => chosenIds.includes(tag.id));
  const validTags = tagIdList(chosenIds.filter((id) => allTags.some((tag) => tag.id === id)));
  useEffect(() => {
    if (tags.isSuccess && search.tags !== validTags)
      void navigate({ search: (previous) => ({ ...previous, tags: validTags }), replace: true });
  }, [navigate, search.tags, tags.isSuccess, validTags]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const applyQuery = useCallback(
    (q: string | undefined) =>
      void navigate({ search: (previous) => ({ ...previous, q }), replace: true }),
    [navigate],
  );
  const [draft, setDraft] = useSearchDraft(search.q, applyQuery, withoutTypedTag);
  const setTags = (ids: readonly string[]) =>
    void navigate({ search: (previous) => ({ ...previous, tags: tagIdList(ids) }) });
  const hashQuery = typedTag.exec(draft)?.[1] ?? null;
  const suggestions = allTags.filter(
    (tag) => !chosenIds.includes(tag.id) && tagNameMatches(tag.name, hashQuery ?? ""),
  );
  const suggesting =
    chosenIds.length < maxTagsPerRecording && hashQuery !== null && draft !== dismissed;

  return (
    <Combobox.Root
      multiple
      items={allTags}
      filteredItems={suggestions}
      filter={null}
      value={chosen}
      isItemEqualToValue={sameTag}
      itemToStringLabel={tagName}
      onValueChange={(next) => {
        setTags(next.map((tag) => tag.id));
        if (next.length > chosen.length)
          setDraft(draft.replace(typedTag, (match) => (match.startsWith("#") ? "" : " ")));
      }}
      inputValue={draft}
      onInputValueChange={(value, details) => {
        if (details.isItemPress) {
          details.cancel();
          return;
        }
        setDraft(value);
      }}
      open={suggesting}
      onOpenChange={(open) => {
        if (!open) setDismissed(draft);
      }}
      autoHighlight
    >
      <div className="group/search relative mt-[22px] flex min-h-10 w-full min-w-0 flex-wrap items-center gap-y-1 rounded-lg border border-transparent bg-muted py-[3px] shadow-well transition-colors has-[[aria-expanded=true]]:border-ring has-[[aria-expanded=true]]:bg-background has-[[aria-expanded=true]]:shadow-none has-[[aria-expanded=true]]:ring-3 has-[[aria-expanded=true]]:ring-ring/20 has-[input:focus-visible]:border-ring has-[input:focus-visible]:bg-background has-[input:focus-visible]:shadow-none has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/20">
        <span className="flex h-8 items-center pr-1 pl-3 text-muted-foreground">
          <HugeiconsIcon icon={Search01Icon} className="size-4" aria-hidden="true" />
        </span>
        <Combobox.Chips
          aria-label="Tag filters"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          {chosen.map((tag) => (
            <Combobox.Chip
              key={tag.id}
              aria-label={tag.name}
              className="rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              render={<TagChip tag={tag} />}
            >
              <Combobox.ChipRemove
                aria-label={`Remove ${tag.name}`}
                className="relative grid size-[18px] shrink-0 cursor-default place-items-center rounded-[5px] opacity-60 transition-opacity outline-none after:absolute after:-inset-1 hover:opacity-100"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className="size-3"
                  aria-hidden="true"
                />
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          <Combobox.Input
            ref={input}
            type="search"
            aria-label="Search"
            maxLength={maxSearchLength}
            autoComplete="off"
            onFocus={() => setDismissed(null)}
            placeholder={
              chosen.length > 0 ? "Search" : "Search titles and transcripts, or type # for tags"
            }
            className={cn(
              "h-8 min-w-[120px] flex-1 bg-transparent pl-2.5 text-base outline-none placeholder:text-muted-foreground md:text-sm [&::-webkit-search-cancel-button]:appearance-none",
              chosen.length > 0 && "min-w-14 pl-1",
            )}
          />
        </Combobox.Chips>
        <span className="flex h-8 items-center gap-0.5 self-start pr-1.5">
          {draft ? (
            <InputGroupButton
              size="icon-sm"
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                applyQuery(undefined);
                input.current?.focus();
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden="true" />
            </InputGroupButton>
          ) : null}
          <TagFilterMenu chosenIds={chosenIds} onChange={setTags} />
        </span>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner
          anchor={input}
          side="bottom"
          align="start"
          sideOffset={4}
          className="isolate z-50"
        >
          <Combobox.Popup className="w-[248px] origin-(--transform-origin) rounded-[14px] bg-popover p-1 text-[13px] text-popover-foreground shadow-menu outline-hidden duration-100 motion-reduce:animate-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <p className="px-2 pt-1 pb-1 text-xs text-muted-foreground">Tags</p>
            <Combobox.Empty>
              <p className="px-2 py-1.5 text-muted-foreground">No tag named “{hashQuery}”</p>
            </Combobox.Empty>
            <Combobox.List aria-label="Tags" className="empty:hidden">
              {(tag: Tag) => (
                <Combobox.Item key={tag.id} value={tag} className={cn(tagRowClassName, "pr-1.5")}>
                  <TagOrb tag={tag} />
                  <span className="min-w-0 flex-1 truncate">
                    <MatchedName name={tag.name} query={hashQuery ?? ""} />
                  </span>
                  <Kbd
                    aria-hidden="true"
                    className="hidden group-data-highlighted/tag:inline-flex pointer-coarse:hidden"
                  >
                    Enter
                  </Kbd>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
