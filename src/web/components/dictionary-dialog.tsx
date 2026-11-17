import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Add01Icon, ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { maxTermCharacters, type DictionaryEntry } from "../../shared/contracts/dictionary.ts";
import { foldSearchText } from "../../shared/search-text.ts";
import { dictionaryKeys, phraseKey } from "../../shared/transcript-dictionary.ts";
import { dictionaryOptions } from "../lib/api.ts";
import { cn } from "../lib/utils.ts";
import { DictionaryEntryEditor } from "./dictionary-entry.tsx";
import { DictionaryHeader } from "./dictionary-header.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Kbd } from "./ui/kbd.tsx";

type View = { kind: "list" } | { kind: "entry"; entry: DictionaryEntry | null; spelling: string };

const quoted = (text: string) => `“${text}”`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function describeEntry(entry: DictionaryEntry) {
  const parts = [
    entry.similar ? "Similar spellings" : "Exact spelling",
    ...(entry.alsoReplace.length > 0 ? [`also ${entry.alsoReplace.map(quoted).join(", ")}`] : []),
    ...(entry.neverChange.length > 0 ? [`never ${entry.neverChange.map(quoted).join(", ")}`] : []),
  ];
  return parts.join(" · ");
}

const rowClassName =
  "relative flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left outline-none hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-2 focus-visible:outline-ring";
const dividerClassName =
  "relative before:absolute before:inset-x-2 before:top-0 before:border-t before:border-border first:before:hidden hover:before:hidden has-[:focus-visible]:before:hidden [li:hover+&]:before:hidden [li:has(:focus-visible)+&]:before:hidden";

function DictionaryList({
  query,
  onQueryChange,
  onOpen,
  search,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (entry: DictionaryEntry | null, spelling: string) => void;
  search: RefObject<HTMLInputElement | null>;
}) {
  const dictionary = useQuery(dictionaryOptions);
  useEffect(() => search.current?.focus(), [search]);
  const entries = dictionary.data ?? [];
  const typed = query.trim().replace(/\s+/gu, " ");
  const folded = foldSearchText(typed);
  const exact = entries.find((entry) => dictionaryKeys(entry).includes(phraseKey(typed)));
  const shown = typed
    ? entries.filter((entry) =>
        [entry.spelling, ...entry.alsoReplace].some((phrase) =>
          foldSearchText(phrase).includes(folded),
        ),
      )
    : entries;
  const fixes = entries.reduce((total, entry) => total + entry.fixes, 0);
  return (
    <>
      <DictionaryHeader title="Dictionary" />
      <DialogDescription className="px-5 pt-1">
        Names and words Movo spells your way in new transcripts.
      </DialogDescription>
      <div className="min-h-0 overflow-y-auto px-5 pt-4">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            aria-hidden="true"
            className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
          />
          <Input
            ref={search}
            type="search"
            aria-label="Find or add a name or word"
            placeholder="Find or add a name or word"
            maxLength={maxTermCharacters}
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !typed) return;
              event.preventDefault();
              onOpen(exact ?? null, typed);
            }}
            className="pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        {dictionary.isPending ? (
          <p className="mt-3 flex items-center gap-2 text-xs/[17px] text-muted-foreground">
            <Spinner />
            Loading the dictionary…
          </p>
        ) : dictionary.isError ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p role="alert" className="text-xs/[17px] wrap-anywhere text-destructive">
              {dictionary.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void dictionary.refetch()}>
              Try again
            </Button>
          </div>
        ) : entries.length === 0 && !typed ? (
          <p className="mt-3 text-xs/[17px] text-pretty text-muted-foreground">
            No words yet. Type a name the model keeps getting wrong, like a product, a person or a
            place.
          </p>
        ) : (
          <ul aria-label="Dictionary entries" className="-mx-2 mt-2">
            {shown.map((entry) => (
              <li key={entry.id} className={dividerClassName}>
                <button
                  type="button"
                  className={rowClassName}
                  onClick={() => onOpen(entry, entry.spelling)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]/[19px] font-medium">
                      {entry.spelling}
                    </span>
                    <span className="block truncate text-xs/[17px] text-muted-foreground">
                      {describeEntry(entry)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {plural(entry.fixes, "fix", "fixes")}
                  </span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    aria-hidden="true"
                    className="-mr-1.5 size-4 text-muted-foreground/70"
                  />
                </button>
              </li>
            ))}
            {typed && !exact ? (
              <li className={dividerClassName}>
                <button
                  type="button"
                  className={cn(rowClassName, "gap-[7px] pl-[18px]")}
                  onClick={() => onOpen(null, typed)}
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    aria-hidden="true"
                    className="size-4 text-primary-strong"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]/[19px] font-medium">
                      Add {quoted(typed)}
                    </span>
                    <span className="block truncate text-xs/[17px] text-muted-foreground">
                      Opens a new entry with this spelling
                    </span>
                  </span>
                  <Kbd>Enter</Kbd>
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
      <DialogFooter className="mt-3">
        {entries.length > 0 ? (
          <p className="mr-auto text-xs text-muted-foreground tabular-nums">
            {plural(entries.length, "entry", "entries")} · {plural(fixes, "fix", "fixes")} so far
          </p>
        ) : null}
        <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
      </DialogFooter>
    </>
  );
}

export function DictionaryDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const search = useRef<HTMLInputElement>(null);
  const dictionary = useQuery({ ...dictionaryOptions, enabled: open });
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const leave = (then: () => void) => {
    if (dirty) setPendingLeave(() => then);
    else then();
  };
  const show = (next: View) => {
    setDirty(false);
    setPendingLeave(null);
    setView(next);
  };
  const showList = () => show({ kind: "list" });
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else leave(() => onOpenChange(false));
      }}
      onOpenChangeComplete={(opened) => {
        if (opened) return;
        setView({ kind: "list" });
        setQuery("");
        setDirty(false);
        setPendingLeave(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={search}
        finalFocus={returnFocus}
        className="flex flex-col overflow-hidden sm:max-w-[480px]"
      >
        {view.kind === "list" ? (
          <DictionaryList
            query={query}
            onQueryChange={setQuery}
            onOpen={(entry, spelling) => {
              setQuery("");
              setView({ kind: "entry", entry, spelling });
            }}
            search={search}
          />
        ) : (
          <DictionaryEntryEditor
            key={view.entry?.id ?? `new:${view.spelling}`}
            entry={view.entry}
            initialSpelling={view.spelling}
            entries={dictionary.data ?? []}
            leaving={pendingLeave !== null}
            onBack={() => leave(showList)}
            onOpenEntry={(entry) =>
              leave(() => show({ kind: "entry", entry, spelling: entry.spelling }))
            }
            onDone={showList}
            onDirtyChange={onDirtyChange}
            onKeepEditing={() => setPendingLeave(null)}
            onDiscard={() => {
              const then = pendingLeave;
              setDirty(false);
              setPendingLeave(null);
              then?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
