import { useRef, useState } from "react";
import { Cancel01Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { mediaToolsOptions } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";
import { type ImportEntry, type ImportOutcome, useMediaImport } from "../lib/media-import.ts";
import { MediaDropZone } from "./media-drop-zone.tsx";
import { MediaToolsSetup } from "./media-tools-setup.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog.tsx";
import { Switch } from "./ui/switch.tsx";

function ImportRow({
  entry,
  importing,
  removable,
  onRemove,
}: {
  entry: ImportEntry;
  importing: boolean;
  removable: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex min-h-10 items-center gap-3 border-t px-3 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{entry.file.name}</p>
        {entry.error ? (
          <p className="mt-0.5 text-xs/[17px] wrap-anywhere text-destructive">{entry.error}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatBytes(entry.file.size)}
      </span>
      {importing ? (
        <Spinner />
      ) : removable ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${entry.file.name}`}
          onClick={onRemove}
        >
          <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

export function ImportMedia() {
  const [open, setOpen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [transcribe, setTranscribe] = useState(false);
  const chooseFiles = useRef<HTMLButtonElement>(null);
  const tools = useQuery(mediaToolsOptions);
  const queue = useMediaImport();
  const count = queue.entries.length;
  const progress =
    queue.position > 0 ? `Importing ${queue.position} of ${queue.total}…` : "Importing…";
  const finish = (outcome: ImportOutcome) => {
    if (outcome === "imported") setOpen(false);
    if (outcome === "toolsMissing") setShowTools(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (queue.pending) return;
        setOpen(next);
        if (next) setShowTools(tools.data?.ffprobe.state !== "ready");
      }}
    >
      <DialogTrigger render={<Button />} disabled={tools.isPending}>
        <HugeiconsIcon icon={Upload04Icon} data-icon="inline-start" aria-hidden="true" />
        Import files
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]" showCloseButton={!queue.pending}>
        <DialogHeader>
          <DialogTitle>Import files</DialogTitle>
        </DialogHeader>
        <div className="px-5 pt-3.5">
          <MediaDropZone ref={chooseFiles} disabled={queue.pending} onFiles={queue.add} />
          {count > 0 ? (
            <>
              <ul
                aria-label="Files to import"
                className="mt-4 max-h-60 overflow-y-auto rounded-[10px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-border)]"
              >
                {queue.entries.map((entry) => (
                  <ImportRow
                    key={entry.id}
                    entry={entry}
                    importing={entry.id === queue.currentId}
                    removable={!queue.pending}
                    onRemove={() => queue.remove(entry.id)}
                  />
                ))}
              </ul>
              <div className="mt-[18px] flex items-center gap-2.5 text-[13px]">
                <Switch
                  id="import-transcribe"
                  checked={transcribe}
                  disabled={queue.pending}
                  onCheckedChange={setTranscribe}
                />
                <label htmlFor="import-transcribe">Transcribe after import</label>
              </div>
            </>
          ) : null}
          {showTools ? (
            <MediaToolsSetup
              className="mt-4 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--color-border)]"
              onClose={() => {
                setShowTools(false);
                chooseFiles.current?.focus();
              }}
            />
          ) : null}
          <output className="sr-only">{queue.pending ? progress : ""}</output>
          {queue.error ? (
            <p role="alert" className="mt-3 text-[13px]/5 wrap-anywhere text-destructive">
              {queue.error.message}
            </p>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Files import one at a time, up to 10 GiB each.
          </p>
          <div className="flex justify-end gap-2">
            {queue.pending ? (
              <Button variant="ghost" onClick={queue.cancel}>
                Cancel
              </Button>
            ) : (
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            )}
            <Button
              aria-busy={queue.pending}
              disabled={count === 0 || queue.pending}
              onClick={() => queue.start(transcribe, finish)}
            >
              {queue.pending ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={Upload04Icon} data-icon="inline-start" aria-hidden="true" />
              )}
              {queue.pending ? progress : count > 1 ? `Import all ${count}` : "Import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
