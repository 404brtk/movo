import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Delete02Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import {
  DictionaryTerm,
  maxTermCharacters,
  type DictionaryDraft,
  type DictionaryEntry,
  type DictionaryFix,
  type DictionaryPreview,
  type DictionarySaveResult,
} from "../../shared/contracts/dictionary.ts";
import {
  allowedDistance,
  allowsSimilar,
  findDictionaryProblem,
  minSimilarLetters,
  type DictionaryProblem,
} from "../../shared/transcript-dictionary.ts";
import { edges } from "../../shared/transcript-edits.ts";
import {
  dictionaryOptions,
  dictionaryPreviewOptions,
  mediaListKey,
  removeDictionaryEntry,
  saveDictionaryEntry,
} from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { DictionaryHeader } from "./dictionary-header.tsx";
import { DictionaryProblemMessage } from "./dictionary-problem.tsx";
import { Spinner } from "./spinner.tsx";
import { TermListField } from "./term-list-field.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { DialogFooter } from "./ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";
import { Switch } from "./ui/switch.tsx";

const previewDelayMs = 300;
const collapsedHits = 3;
const quoted = (text: string) => `“${text}”`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const isTerm = Schema.is(DictionaryTerm);
const hitKey = (mediaId: string, firstWord: number) => `${mediaId}:${firstWord}`;

function useSettledValue<T>(value: T, key: string) {
  const [settled, setSettled] = useState({ value, key });
  useEffect(() => {
    const timer = setTimeout(
      () => setSettled((current) => (current.key === key ? current : { value, key })),
      previewDelayMs,
    );
    return () => clearTimeout(timer);
  }, [key, value]);
  return settled;
}

function similarDescription(spelling: string, preview: DictionaryPreview | undefined) {
  if (!allowsSimilar(spelling))
    return `Off for words of ${minSimilarLetters - 1} letters or fewer, so ordinary words stay as they are. Add what the model hears under Also replace.`;
  const distance = plural(allowedDistance(spelling), "letter", "letters");
  const examples = [
    ...new Set(
      (preview?.recordings ?? []).flatMap((recording) =>
        recording.hits.filter((hit) => hit.similar).map((hit) => edges(hit.before).core),
      ),
    ),
  ].slice(0, 2);
  return examples.length > 0
    ? `Also fixes ${examples.map(quoted).join(" and ")}, up to ${distance} off`
    : `Also fixes spellings up to ${distance} off`;
}

function fixesFor(preview: DictionaryPreview | undefined, unticked: ReadonlySet<string>) {
  return (preview?.recordings ?? []).flatMap((recording): DictionaryFix[] => {
    const skip = recording.hits
      .filter((hit) => unticked.has(hitKey(recording.mediaId, hit.firstWord)))
      .map((hit) => hit.firstWord);
    return recording.hitCount > skip.length
      ? [{ mediaId: recording.mediaId, revision: recording.revision, skip }]
      : [];
  });
}

function savedToast(result: DictionarySaveResult) {
  const skipped = result.skipped.map((recording) => `${recording.title}: ${recording.reason}`);
  if (result.fixedWords === 0)
    return skipped.length > 0
      ? { title: `Saved ${result.entry.spelling}`, description: skipped.join(" ") }
      : null;
  return {
    title: `Fixed ${plural(result.fixedWords, "word", "words")} in ${plural(result.fixedRecordings, "recording", "recordings")}`,
    description: ["Each change is in that recording's History.", ...skipped].join(" "),
  };
}

export function DictionaryEntryEditor({
  entry,
  initialSpelling,
  entries,
  leaving,
  onBack,
  onOpenEntry,
  onDone,
  onDirtyChange,
  onKeepEditing,
  onDiscard,
}: {
  entry: DictionaryEntry | null;
  initialSpelling: string;
  entries: readonly DictionaryEntry[];
  leaving: boolean;
  onBack: () => void;
  onOpenEntry: (entry: DictionaryEntry) => void;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const queryClient = useQueryClient();
  const { add: addToast } = Toast.useToastManager();
  const spellingId = useId();
  const spellingErrorId = useId();
  const similarId = useId();
  const similarHintId = useId();
  const previewHeadingId = useId();
  const spellingInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [spelling, setSpelling] = useState(entry?.spelling ?? initialSpelling);
  const [similar, setSimilar] = useState(entry?.similar ?? false);
  const [alsoReplace, setAlsoReplace] = useState<readonly string[]>(entry?.alsoReplace ?? []);
  const [neverChange, setNeverChange] = useState<readonly string[]>(entry?.neverChange ?? []);
  const [pendingAlsoReplace, setPendingAlsoReplace] = useState("");
  const [pendingNeverChange, setPendingNeverChange] = useState("");
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [removing, setRemoving] = useState(false);

  const draft: DictionaryDraft = useMemo(
    () => ({
      spelling: spelling.trim().replace(/\s+/gu, " "),
      similar: similar && allowsSimilar(spelling),
      alsoReplace,
      neverChange,
    }),
    [spelling, similar, alsoReplace, neverChange],
  );
  const draftKey = JSON.stringify(draft);
  const [initialKey] = useState(draftKey);
  const dirty =
    draftKey !== initialKey ||
    unticked.size > 0 ||
    pendingAlsoReplace.trim() !== "" ||
    pendingNeverChange.trim() !== "";
  useLayoutEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => spellingInput.current?.focus(), []);

  const others = useMemo(
    () => entries.filter((each) => each.id !== entry?.id),
    [entries, entry?.id],
  );
  const problemWith = (
    candidate: DictionaryDraft,
  ): DictionaryProblem<DictionaryEntry> | undefined =>
    isTerm(candidate.spelling) ? findDictionaryProblem(candidate, others) : undefined;
  const problem = problemWith(draft);
  const ready = isTerm(draft.spelling) && problem === undefined;

  const settled = useSettledValue(draft, draftKey);
  const settledReady = isTerm(settled.value.spelling) && !problemWith(settled.value);
  const preview = useQuery({
    ...dictionaryPreviewOptions({ id: entry?.id ?? null, draft: settled.value }),
    enabled: settledReady,
  });
  const previewCurrent =
    ready && settled.key === draftKey && preview.isSuccess && !preview.isPlaceholderData;
  const fixes = previewCurrent ? fixesFor(preview.data, unticked) : [];
  const hits = (preview.data?.recordings ?? []).flatMap((recording) =>
    recording.hits.map((hit) => ({
      ...hit,
      key: hitKey(recording.mediaId, hit.firstWord),
      title: recording.title,
    })),
  );
  const shownHits = showAll ? hits : hits.slice(0, collapsedHits);
  const hiddenHits = (preview.data?.hitCount ?? 0) - shownHits.length;

  const save = useMutation({
    mutationFn: (fix: readonly DictionaryFix[]) =>
      saveDictionaryEntry(entry?.id ?? null, { draft, fix }),
    onSuccess: async (result) => {
      const toast = savedToast(result);
      if (toast) addToast(toast);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dictionaryOptions.queryKey }),
        ...(result.fixedWords > 0
          ? [
              queryClient.invalidateQueries({ queryKey: ["transcription"] }),
              queryClient.invalidateQueries({ queryKey: mediaListKey }),
            ]
          : []),
      ]);
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeDictionaryEntry(id),
    onSuccess: (list) => {
      queryClient.setQueryData(dictionaryOptions.queryKey, list);
      setRemoving(false);
      onDone();
    },
  });

  const verb = entry ? "Save" : "Add";
  const busy = save.isPending;
  const fixing = busy && (save.variables?.length ?? 0) > 0;
  const spellingError = problem?.field === "spelling" ? problem : null;
  const keptCount = hits.filter((hit) => unticked.has(hit.key)).length;
  const previewSummary = preview.data?.hitCount
    ? [
        `${preview.data.hitCount} in ${plural(preview.data.recordings.length, "recording", "recordings")}`,
        ...(keptCount > 0 ? [`${keptCount} left as heard`] : []),
      ].join(" · ")
    : null;

  return (
    <>
      <DictionaryHeader
        title={entry ? entry.spelling : "New entry"}
        onBack={onBack}
        actions={
          entry ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                ref={menuTrigger}
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label={`${entry.spelling} actions`}
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[216px]">
                <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
                  <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                  Remove from dictionary…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      <form
        aria-label={entry ? `Edit ${entry.spelling}` : "New dictionary entry"}
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy && !leaving) save.mutate([]);
        }}
      >
        <div className="grid min-h-0 gap-4 overflow-y-auto px-5 pt-4">
          <div>
            <label htmlFor={spellingId} className="mb-1.5 block text-xs/4 font-medium">
              Spelled
            </label>
            <Input
              id={spellingId}
              ref={spellingInput}
              required
              maxLength={maxTermCharacters}
              autoComplete="off"
              value={spelling}
              disabled={busy}
              onChange={(event) => setSpelling(event.currentTarget.value)}
              aria-invalid={spellingError ? true : undefined}
              aria-describedby={spellingError ? spellingErrorId : undefined}
            />
            {spellingError ? (
              <DictionaryProblemMessage
                id={spellingErrorId}
                problem={spellingError}
                onOpenEntry={onOpenEntry}
              />
            ) : null}
          </div>
          <div className="flex items-start gap-2.5">
            <Switch
              id={similarId}
              checked={draft.similar}
              disabled={busy || !allowsSimilar(spelling)}
              onCheckedChange={setSimilar}
              aria-describedby={similarHintId}
            />
            <div className="min-w-0">
              <label
                htmlFor={similarId}
                className={cn(
                  "block text-[13px]/5 font-medium",
                  !allowsSimilar(spelling) && "text-muted-foreground",
                )}
              >
                Similar spellings
              </label>
              <p id={similarHintId} className="text-xs/[17px] text-pretty text-muted-foreground">
                {similarDescription(draft.spelling, previewCurrent ? preview.data : undefined)}
              </p>
            </div>
          </div>
          <TermListField
            label="Also replace"
            hint="what the model hears differently"
            terms={alsoReplace}
            onChange={setAlsoReplace}
            pending={pendingAlsoReplace}
            onPendingChange={setPendingAlsoReplace}
            problemWith={(terms) => {
              const found = problemWith({ ...draft, alsoReplace: terms });
              return found?.field === "alsoReplace" ? found : undefined;
            }}
            onOpenEntry={onOpenEntry}
            disabled={busy}
          />
          <TermListField
            label="Never change"
            hint="left as heard"
            terms={neverChange}
            onChange={setNeverChange}
            pending={pendingNeverChange}
            onPendingChange={setPendingNeverChange}
            problemWith={(terms) => {
              const found = problemWith({ ...draft, neverChange: terms });
              return found?.field === "neverChange" ? found : undefined;
            }}
            onOpenEntry={onOpenEntry}
            disabled={busy}
          />
          <section
            aria-labelledby={previewHeadingId}
            aria-busy={preview.isFetching}
            className="rounded-xl bg-subtle px-3 pt-2.5 shadow-[inset_0_0_0_1px_var(--color-border)]"
          >
            <h3 id={previewHeadingId} className="pb-2 text-[12.5px]/[18px] font-semibold">
              Already in your library
              {previewSummary ? (
                <span className="ml-1 font-normal text-muted-foreground tabular-nums">
                  {previewSummary}
                </span>
              ) : null}
            </h3>
            {!settledReady ? (
              <p className="border-t py-2.5 text-xs/[17px] text-muted-foreground">
                Spell the word to see where it would change.
              </p>
            ) : preview.isError ? (
              <p role="alert" className="border-t py-2.5 text-xs/[17px] text-destructive">
                {preview.error.message}
              </p>
            ) : !preview.data ? (
              <p className="flex items-center gap-2 border-t py-2.5 text-xs/[17px] text-muted-foreground">
                <Spinner />
                Looking through your library…
              </p>
            ) : hits.length === 0 ? (
              <p className="border-t py-2.5 text-xs/[17px] text-muted-foreground">
                Nothing to fix yet. New transcripts will use it.
              </p>
            ) : (
              <ul aria-label="Matches in your library">
                {shownHits.map((hit) => {
                  const kept = unticked.has(hit.key);
                  const id = `${previewHeadingId}-${hit.key}`;
                  return (
                    <li key={hit.key} className="flex items-start gap-2.5 border-t py-2">
                      <Checkbox
                        id={id}
                        checked={!kept}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setUnticked((current) => {
                            const next = new Set(current);
                            if (checked) next.delete(hit.key);
                            else next.add(hit.key);
                            return next;
                          })
                        }
                      />
                      <label
                        htmlFor={id}
                        className={cn(
                          "min-w-0 flex-1 text-[12.5px]/[18px] wrap-anywhere",
                          kept && "text-muted-foreground",
                        )}
                      >
                        {hit.leading ? `${hit.moreBefore ? "…" : ""}${hit.leading} ` : null}
                        <del
                          className={cn(
                            "decoration-1",
                            kept ? "text-foreground no-underline" : "text-muted-foreground/70",
                          )}
                        >
                          {hit.before}
                        </del>{" "}
                        <ins
                          className={cn(
                            "rounded-sm px-[3px] no-underline",
                            kept
                              ? "text-muted-foreground/70 line-through"
                              : "bg-highlight font-[550] text-primary-deep",
                          )}
                        >
                          {hit.after}
                        </ins>
                        {hit.trailing ? ` ${hit.trailing}${hit.moreAfter ? "…" : ""}` : null}
                        <span className="mt-px block text-xs/[17px] text-muted-foreground tabular-nums">
                          {hit.title} · {formatDuration(hit.startMs / 1000)}
                        </span>
                      </label>
                    </li>
                  );
                })}
                {hiddenHits > 0 ? (
                  <li className="border-t">
                    {hits.length > shownHits.length ? (
                      <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="block w-full rounded-sm py-2 text-left text-xs/[17px] text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Show {hiddenHits} more
                      </button>
                    ) : (
                      <p className="py-2 text-xs/[17px] text-muted-foreground">
                        {hiddenHits} more will be fixed too.
                      </p>
                    )}
                  </li>
                ) : null}
              </ul>
            )}
          </section>
          {save.isError ? (
            <p role="alert" className="text-xs/[17px] wrap-anywhere text-destructive">
              {save.error.message}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {leaving ? (
            <>
              <p className="mr-auto text-[13px]/5">Discard your changes?</p>
              <Button variant="ghost" onClick={onKeepEditing}>
                Keep editing
              </Button>
              <Button variant="outline" onClick={onDiscard}>
                Discard
              </Button>
            </>
          ) : fixes.length > 0 ? (
            <>
              <Button
                type="submit"
                variant="outline"
                aria-busy={busy && !fixing}
                disabled={!ready || busy}
              >
                {busy && !fixing ? <Spinner /> : null}
                {busy && !fixing ? "Saving…" : verb}
              </Button>
              <Button
                type="button"
                aria-busy={fixing}
                disabled={!ready || busy}
                onClick={() => save.mutate(fixes)}
              >
                {fixing ? <Spinner /> : null}
                {fixing
                  ? "Fixing…"
                  : `${verb} and fix ${plural(fixes.length, "recording", "recordings")}`}
              </Button>
            </>
          ) : (
            <Button type="submit" aria-busy={busy} disabled={!ready || busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Saving…" : verb}
            </Button>
          )}
        </DialogFooter>
      </form>
      {entry ? (
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          returnFocus={menuTrigger}
          icon={Delete02Icon}
          title={`Remove ${entry.spelling} from the dictionary?`}
          description="Words it already fixed stay as they are. New transcripts keep what the model heard."
          keep="Keep it"
          confirm="Remove"
          pending="Removing…"
          busy={remove.isPending}
          error={remove.error?.message ?? null}
          onConfirm={() => remove.mutate(entry.id)}
        />
      ) : null}
    </>
  );
}
