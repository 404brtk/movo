import type { ReactNode } from "react";
import type { TextRange } from "../../shared/contracts/library.ts";

export function HighlightedText({ text, ranges }: { text: string; ranges: readonly TextRange[] }) {
  const parts: ReactNode[] = [];
  let shown = 0;
  for (const [index, range] of ranges.entries()) {
    parts.push(
      text.slice(shown, range.start),
      <mark key={index} className="rounded-sm bg-primary/15 text-foreground">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    shown = range.end;
  }
  parts.push(text.slice(shown));
  return parts;
}
