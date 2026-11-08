import { useState } from "react";
import { maxEditCharacters } from "../../shared/contracts/transcriptions.ts";
import type { TranscriptPassage } from "../../shared/transcript-passages.ts";
import { editTranscript } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

const focusAtEnd = (input: HTMLTextAreaElement | null) => {
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
};

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
  const [text, setText] = useState(passage.text);
  const [target] = useState(() => ({
    revision,
    firstWord: passage.firstWord,
    wordCount: passage.words.length,
  }));
  const save = useTranscriptChange(mediaId, (value: string) =>
    editTranscript(mediaId, { ...target, text: value }),
  );
  const submit = () => {
    if (!save.isPending) save.mutate(text, { onSuccess: onClose });
  };
  const hintId = `passage-hint-${passage.firstWord}`;
  const errorId = `passage-error-${passage.firstWord}`;
  return (
    <form
      aria-label={`Edit passage at ${formatDuration(passage.startMs / 1000)}`}
      className="min-w-0 flex-1 space-y-3 py-1"
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
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        Ctrl+Enter saves and Esc cancels. Clear the text to remove the passage. Every change can be
        undone from History.
      </p>
      {save.isError ? (
        <p id={errorId} role="alert" className="text-sm wrap-anywhere text-destructive">
          {save.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="h-10 px-3 text-sm" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save passage"}
        </Button>
        <Button
          variant="outline"
          className="h-10 px-3 text-sm"
          disabled={save.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
