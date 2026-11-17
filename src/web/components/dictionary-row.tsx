import { useId } from "react";
import { TextCheckIcon } from "@hugeicons/core-free-icons";
import { AccentIcon } from "./accent-icon.tsx";
import { Button } from "./ui/button.tsx";

export function DictionaryRow() {
  const headingId = useId();
  const descriptionId = useId();
  return (
    <li aria-labelledby={headingId} className="flex items-center gap-3.5 py-3">
      <span className="w-[30px] shrink-0 self-start pt-px">
        <AccentIcon icon={TextCheckIcon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="text-[13.5px]/[normal] font-medium">
          Dictionary
        </h3>
        <p id={descriptionId} className="mt-px text-xs/[18px] text-pretty text-muted-foreground">
          Names and words Movo spells your way in new transcripts. Coming soon.
        </p>
      </div>
      <Button variant="outline" size="sm" disabled aria-describedby={descriptionId}>
        Manage
      </Button>
    </li>
  );
}
