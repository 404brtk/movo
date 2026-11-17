import { useId, useRef, useState } from "react";
import { TextCheckIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { dictionaryOptions } from "../lib/api.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { DictionaryDialog } from "./dictionary-dialog.tsx";
import { Button } from "./ui/button.tsx";

const intro = "Names and words Movo spells your way in new transcripts.";

export function DictionaryRow() {
  const headingId = useId();
  const descriptionId = useId();
  const manage = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const dictionary = useQuery(dictionaryOptions);
  const entries = dictionary.data ?? [];
  const description = dictionary.isError
    ? dictionary.error.message
    : entries.length > 0
      ? `${entries.length} ${entries.length === 1 ? "name or word" : "names and words"} Movo spells your way · ${entries.map((entry) => entry.spelling).join(", ")}`
      : intro;
  return (
    <li aria-labelledby={headingId} className="flex items-center gap-3.5 py-3">
      <span className="w-[30px] shrink-0 self-start pt-px">
        <AccentIcon icon={TextCheckIcon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="text-[13.5px]/[normal] font-medium">
          Dictionary
        </h3>
        <p
          id={descriptionId}
          role={dictionary.isError ? "alert" : undefined}
          className={
            dictionary.isError
              ? "mt-px text-xs/[18px] wrap-anywhere text-destructive"
              : "mt-px truncate text-xs/[18px] text-muted-foreground"
          }
        >
          {description}
        </p>
      </div>
      <Button
        ref={manage}
        variant="outline"
        size="sm"
        aria-describedby={descriptionId}
        onClick={() => setOpen(true)}
      >
        Manage
      </Button>
      <DictionaryDialog open={open} onOpenChange={setOpen} returnFocus={manage} />
    </li>
  );
}
