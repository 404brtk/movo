import { useId, useState } from "react";
import { ArrowDown01Icon, LibraryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { maxScopeRecordings, type ChatScope } from "../../shared/contracts/ask.ts";
import { mediaListOptions } from "../lib/api.ts";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";

export function scopeLabel(scope: ChatScope | null) {
  if (scope?.mediaIds)
    return `${scope.mediaIds.length} ${scope.mediaIds.length === 1 ? "recording" : "recordings"}`;
  if (scope?.kind === "audio") return "Audio";
  if (scope?.kind === "video") return "Video";
  return "All recordings";
}

function ChooseRecordings({
  open,
  onOpenChange,
  initial,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: readonly string[];
  onChoose: (mediaIds: string[]) => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string[]>([...initial]);
  const recordings = useQuery({
    ...mediaListOptions({ transcript: "available", sort: "title" }),
    enabled: open,
  });
  const terms = search.trim().toLowerCase();
  const items = (recordings.data?.items ?? []).filter(
    (item) => !terms || item.title.toLowerCase().includes(terms),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Choose recordings</DialogTitle>
          <DialogDescription>Ask answers only from the recordings you tick.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 px-5 pt-3.5">
          <label htmlFor={searchId} className="sr-only">
            Find a recording
          </label>
          <Input
            id={searchId}
            placeholder="Find a recording"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ul
            aria-label="Transcribed recordings"
            className="-mx-1.5 mt-2 max-h-[300px] overflow-y-auto"
          >
            {recordings.isError ? (
              <li role="alert" className="px-1.5 py-2 text-xs text-destructive">
                {recordings.error.message}
              </li>
            ) : null}
            {items.map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={chosen.includes(item.id)}
                    disabled={!chosen.includes(item.id) && chosen.length >= maxScopeRecordings}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span className="min-w-0 truncate text-[13px]">{item.title}</span>
                </label>
              </li>
            ))}
            {recordings.isSuccess && items.length === 0 ? (
              <li className="px-1.5 py-2 text-xs text-muted-foreground">
                No transcribed recording matches.
              </li>
            ) : null}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={chosen.length === 0}
            onClick={() => {
              onChoose(chosen);
              onOpenChange(false);
            }}
          >
            {chosen.length === 0 ? "Choose recordings" : `Use ${scopeLabel({ mediaIds: chosen })}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScopePicker({
  scope,
  onChange,
  disabled,
}: {
  scope: ChatScope | null;
  onChange: (scope: ChatScope | null) => void;
  disabled?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const value = scope?.mediaIds ? "chosen" : (scope?.kind ?? "all");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={`Scope: ${scopeLabel(scope)}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45 aria-expanded:bg-muted aria-expanded:text-foreground"
        >
          <HugeiconsIcon icon={LibraryIcon} size={14} aria-hidden="true" />
          {scopeLabel(scope)}
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-[240px]">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next === "all") onChange(null);
              if (next === "audio" || next === "video") onChange({ kind: next });
            }}
          >
            <DropdownMenuRadioItem value="all">All recordings</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="audio">Audio</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="video">Video</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setChoosing(true)}>Choose recordings…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {choosing ? (
        <ChooseRecordings
          open={choosing}
          onOpenChange={setChoosing}
          initial={scope?.mediaIds ?? []}
          onChoose={(mediaIds) => onChange({ mediaIds })}
        />
      ) : null}
    </>
  );
}
