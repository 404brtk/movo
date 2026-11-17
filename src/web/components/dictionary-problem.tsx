import type { DictionaryEntry } from "../../shared/contracts/dictionary.ts";
import type { DictionaryProblem } from "../../shared/transcript-dictionary.ts";

export function DictionaryProblemMessage({
  id,
  problem,
  onOpenEntry,
}: {
  id: string;
  problem: DictionaryProblem<DictionaryEntry>;
  onOpenEntry: (entry: DictionaryEntry) => void;
}) {
  const { owner } = problem;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs/[17px] text-destructive">
      {problem.message}
      {owner ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => onOpenEntry(owner)}
            className="rounded-sm font-medium underline decoration-destructive/40 underline-offset-3 outline-none hover:decoration-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open {owner.spelling}
          </button>
        </>
      ) : null}
    </p>
  );
}
