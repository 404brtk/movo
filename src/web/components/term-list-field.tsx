import { useId, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  maxTermCharacters,
  maxTermVariants,
  type DictionaryEntry,
} from "../../shared/contracts/dictionary.ts";
import type { DictionaryProblem } from "../../shared/transcript-dictionary.ts";
import { DictionaryProblemMessage } from "./dictionary-problem.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export function TermListField({
  label,
  hint,
  terms,
  onChange,
  pending,
  onPendingChange,
  problemWith,
  onOpenEntry,
}: {
  label: string;
  hint: string;
  terms: readonly string[];
  onChange: (terms: string[]) => void;
  pending: string;
  onPendingChange: (pending: string) => void;
  problemWith: (terms: string[]) => DictionaryProblem<DictionaryEntry> | undefined;
  onOpenEntry: (entry: DictionaryEntry) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const [error, setError] = useState<DictionaryProblem<DictionaryEntry> | null>(null);
  const add = () => {
    const term = pending.trim().replace(/\s+/gu, " ");
    if (!term) {
      onPendingChange("");
      setError(null);
      return;
    }
    const next = [...terms, term];
    const problem = problemWith(next);
    if (problem) {
      setError(problem);
      return;
    }
    onChange(next);
    onPendingChange("");
    setError(null);
  };
  const shown = error ?? problemWith([...terms]);
  return (
    <fieldset
      aria-labelledby={labelId}
      aria-describedby={shown ? `${hintId} ${errorId}` : hintId}
      className="min-w-0"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs/4">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        <span id={hintId} className="text-right text-muted-foreground">
          {hint}
        </span>
      </div>
      <ul className="flex flex-wrap items-center gap-1.5">
        {terms.map((term) => (
          <li
            key={term}
            className="inline-flex h-8 max-w-full items-center rounded-[7px] bg-muted pr-[3px] pl-[9px] text-[12.5px]/none font-medium shadow-[inset_0_0_0_1px_var(--color-border)] md:h-[26px]"
          >
            <span className="truncate">{term}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-0.5 text-muted-foreground"
              aria-label={`Remove “${term}”`}
              onClick={() => onChange(terms.filter((each) => each !== term))}
            >
              <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" className="size-3" />
            </Button>
          </li>
        ))}
        {terms.length < maxTermVariants ? (
          <li>
            <Input
              aria-label={`Add to ${label}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              placeholder="Add…"
              maxLength={maxTermCharacters}
              autoComplete="off"
              value={pending}
              onChange={(event) => {
                onPendingChange(event.currentTarget.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                add();
              }}
              onBlur={add}
              className="h-8 w-[120px] rounded-[7px] px-2 md:h-[26px] md:text-[12.5px]"
            />
          </li>
        ) : null}
      </ul>
      {shown ? (
        <DictionaryProblemMessage id={errorId} problem={shown} onOpenEntry={onOpenEntry} />
      ) : null}
    </fieldset>
  );
}
