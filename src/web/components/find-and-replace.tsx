import { useDeferredValue, useMemo, useState } from "react";
import { maxReplaceCharacters, type Transcript } from "../../shared/contracts/transcriptions.ts";
import { replaceWords } from "../../shared/transcript-edits.ts";
import { replaceInTranscript } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

const previewLimit = 50;
const focusOnMount = (input: HTMLInputElement | null) => input?.focus();
const joined = (words: readonly { text: string }[]) => words.map((word) => word.text).join(" ");

export function FindAndReplace({
  mediaId,
  revision,
  transcript,
  onClose,
}: {
  mediaId: string;
  revision: number;
  transcript: Transcript;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaced, setReplaced] = useState<number | null>(null);
  const previewFind = useDeferredValue(find);
  const previewReplacement = useDeferredValue(replacement);
  const matches = useMemo(
    () => replaceWords(transcript.words, previewFind, previewReplacement),
    [transcript.words, previewFind, previewReplacement],
  );
  const replace = useTranscriptChange(mediaId, () =>
    replaceInTranscript(mediaId, { revision, find, replacement }),
  );
  const previewCurrent = previewFind === find && previewReplacement === replacement;
  const searching = find.trim().length > 0;
  return (
    <form
      aria-label="Find and replace"
      className="space-y-4 rounded-xl border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (replace.isPending || matches.length === 0 || !previewCurrent) return;
        const count = matches.length;
        replace.mutate(undefined, { onSuccess: () => setReplaced(count) });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="transcript-find" className="block text-sm font-medium">
            Find
          </label>
          <Input
            ref={focusOnMount}
            id="transcript-find"
            maxLength={maxReplaceCharacters}
            value={find}
            disabled={replace.isPending}
            onChange={(event) => {
              setFind(event.target.value);
              setReplaced(null);
            }}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="transcript-replacement" className="block text-sm font-medium">
            Replace with
          </label>
          <Input
            id="transcript-replacement"
            maxLength={maxReplaceCharacters}
            value={replacement}
            disabled={replace.isPending}
            onChange={(event) => {
              setReplacement(event.target.value);
              setReplaced(null);
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Matches whole words, ignoring case but not accents. Punctuation around each match is kept.
        Leave the replacement empty to remove the matches.
      </p>
      <output aria-live="polite" className="block text-sm">
        {replaced !== null
          ? `Replaced ${replaced} ${replaced === 1 ? "match" : "matches"}.`
          : searching && previewCurrent
            ? `${matches.length} ${matches.length === 1 ? "match" : "matches"} to replace.`
            : ""}
      </output>
      {replace.isError ? (
        <p role="alert" className="text-sm wrap-anywhere text-destructive">
          {replace.error.message}
        </p>
      ) : null}
      {searching && matches.length > 0 ? (
        <ul
          aria-label="Changes to make"
          className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm"
        >
          {matches.slice(0, previewLimit).map((match) => (
            <li key={match.firstWord} className="flex gap-4 px-4 py-2">
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatDuration((match.removed[0]?.startMs ?? 0) / 1000)}
              </span>
              <span className="min-w-0 wrap-anywhere">
                <del className="text-muted-foreground">{joined(match.removed)}</del>
                {" → "}
                {match.inserted.length > 0 ? (
                  <ins className="no-underline">{joined(match.inserted)}</ins>
                ) : (
                  "removed"
                )}
              </span>
            </li>
          ))}
          {matches.length > previewLimit ? (
            <li className="px-4 py-2 text-muted-foreground">
              and {matches.length - previewLimit} more
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          className="h-10 px-3 text-sm"
          disabled={replace.isPending || matches.length === 0 || !previewCurrent}
        >
          {replace.isPending ? "Replacing…" : "Replace all"}
        </Button>
        <Button variant="outline" className="h-10 px-3 text-sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}
