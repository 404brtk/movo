import { useState } from "react";
import { maxEditCharacters } from "../../shared/contracts/transcriptions.ts";
import type { TranscriptPassage } from "../../shared/transcript-passages.ts";
import { editTranscript } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import { Kbd } from "./ui/kbd.tsx";
import { Textarea } from "./ui/textarea.tsx";

const focusAtEnd = (input: HTMLTextAreaElement | null) => {
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
};
const modifierKey = /Mac|iPhone|iPad/u.test(globalThis.navigator?.userAgent ?? "") ? "⌘" : "Ctrl";

export function PassageEditor({
  mediaId,
  revision,
  passage,
  onClose,
}: {
  mediaId: string;
  revision: number;
  passage: TranscriptPassage;
  onClose: () => void;
}) {
  const current = { revision, firstWord: passage.firstWord, wordCount: passage.words.length };
  const [text, setText] = useState(passage.text);
  const [target, setTarget] = useState(current);
  const save = useTranscriptChange(mediaId, (value: string) =>
    editTranscript(mediaId, { ...target, text: value }),
  );
  const stale = target.revision !== revision;
  const submit = () => {
    if (!save.isPending && !stale) save.mutate(text, { onSuccess: onClose });
  };
  const hintId = `passage-hint-${passage.firstWord}`;
  const errorId = `passage-error-${passage.firstWord}`;
  return (
    <form
      aria-label={`Edit passage at ${formatDuration(passage.startMs / 1000)}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        ref={focusAtEnd}
        aria-label="Passage text"
        aria-describedby={save.isError ? `${hintId} ${errorId}` : hintId}
        aria-invalid={save.isError || undefined}
        maxLength={maxEditCharacters}
        value={text}
        disabled={save.isPending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !save.isPending) {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
        className="mt-1.5 min-h-[92px] rounded-[9px] px-2.5 py-2 text-[17px]/7 md:text-[17px]/7"
      />
      {save.isError && !stale ? (
        <p id={errorId} role="alert" className="mt-2 text-[13px]/5 wrap-anywhere text-destructive">
          {save.error.message}
        </p>
      ) : null}
      {stale ? (
        <div
          role="alert"
          className="mt-2.5 space-y-2.5 rounded-[10px] bg-subtle p-3 text-[13px]/5 shadow-[inset_0_0_0_1px_var(--color-border)]"
        >
          <p className="wrap-anywhere">
            The transcript changed while you were editing. This passage now reads “{passage.text}”.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              save.reset();
              setTarget(current);
            }}
          >
            Use my text for the current passage
          </Button>
        </div>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p id={hintId} className="text-xs text-muted-foreground">
          <span className="pointer-coarse:hidden">
            <Kbd>{modifierKey}</Kbd> <Kbd>Enter</Kbd> to save · <Kbd>Esc</Kbd> to cancel
          </span>
          <span className="sr-only">
            . Clear the text to remove the passage. Every change can be undone from History.
          </span>
        </p>
        <div className="ml-auto flex gap-1.5">
          <Button variant="ghost" size="sm" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            aria-busy={save.isPending}
            disabled={save.isPending || stale}
          >
            {save.isPending ? <Spinner /> : null}
            {save.isPending ? "Saving…" : "Save passage"}
          </Button>
        </div>
      </div>
    </form>
  );
}
