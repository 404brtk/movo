import type { ReactNode } from "react";
import type { TextRange } from "../../shared/contracts/library.ts";

export function HighlightedText({ text, ranges }: { text: string; ranges: readonly TextRange[] }) {
  const parts: ReactNode[] = [];
  let shown = 0;
  for (const [index, range] of ranges.entries()) {
    parts.push(
      text.slice(shown, range.start),
      <mark
        key={index}
        className="rounded-[3px] bg-highlight text-inherit shadow-[0_0_0_1.5px_var(--color-highlight)]"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    shown = range.end;
  }
  parts.push(text.slice(shown));
  return parts;
}
