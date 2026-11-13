import { useRef, useState } from "react";
import { ArrowDown01Icon, UserAdd01Icon, UserSwitchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { maxSpeakerNameCharacters } from "../../shared/contracts/transcriptions.ts";
import type { TranscriptPassage } from "../../shared/transcript-passages.ts";
import type { TranscriptSpeakers } from "../../shared/transcript-speakers.ts";
import { assignSpeaker, mergeSpeakers, renameSpeaker } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";

export interface SpeakerEditing {
  mediaId: string;
  revision: number;
  speakers: TranscriptSpeakers;
}

function ChangeError({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="mt-1 text-xs wrap-anywhere text-destructive">
      {error.message}
    </p>
  ) : null;
}

function SpeakerNameDialog({
  editing: { mediaId, speakers },
  speaker,
  open,
  onOpenChange,
}: {
  editing: SpeakerEditing;
  speaker: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(speakers.nameOf(speaker) ?? "");
  const input = useRef<HTMLInputElement>(null);
  const rename = useTranscriptChange(mediaId, (value: string) =>
    renameSpeaker(mediaId, { speaker, name: value }),
  );
  const errorId = `speaker-name-error-${speaker}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (rename.isPending) return;
        rename.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent initialFocus={input} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Name {speakers.label(speaker)}</DialogTitle>
        </DialogHeader>
        <form
          aria-label="Name speaker"
          onSubmit={(event) => {
            event.preventDefault();
            if (!rename.isPending)
              rename.mutate(name.trim(), { onSuccess: () => onOpenChange(false) });
          }}
        >
          <div className="px-5 pt-3.5">
            <label htmlFor={`speaker-name-${speaker}`} className="mb-1.5 block text-xs font-medium">
              Name
            </label>
            <Input
              id={`speaker-name-${speaker}`}
              ref={input}
              maxLength={maxSpeakerNameCharacters}
              value={name}
              placeholder={`Speaker ${speaker}`}
              disabled={rename.isPending}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={rename.isError || undefined}
              aria-describedby={rename.isError ? errorId : undefined}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The name appears everywhere in this transcript. Leave it empty to use the number.
            </p>
            {rename.isError ? (
              <p id={errorId} role="alert" className="mt-2 text-xs wrap-anywhere text-destructive">
                {rename.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />} disabled={rename.isPending}>
              Cancel
            </DialogClose>
            <Button type="submit" aria-busy={rename.isPending} disabled={rename.isPending}>
              {rename.isPending ? <Spinner /> : null}
              {rename.isPending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const headingClassName = "mb-1 text-[13px]/5 font-semibold";

export function SpeakerHeading({
  speaker,
  editing,
  label,
}: {
  speaker: number;
  editing: SpeakerEditing | undefined;
  label: string;
}) {
  return editing ? (
    <EditableSpeakerHeading speaker={speaker} editing={editing} label={label} />
  ) : (
    <p className={headingClassName}>{label}</p>
  );
}

function EditableSpeakerHeading({
  speaker,
  editing,
  label,
}: {
  speaker: number;
  editing: SpeakerEditing;
  label: string;
}) {
  const [naming, setNaming] = useState(false);
  const merge = useTranscriptChange(editing.mediaId, (into: number) =>
    mergeSpeakers(editing.mediaId, { revision: editing.revision, speaker, into }),
  );
  const others = editing.speakers.ids.filter((id) => id !== speaker);
  return (
    <div className="mb-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="xs" />}
          className="-ml-2 gap-1 text-[13px] font-semibold"
          aria-label={`${label}, speaker options`}
          disabled={merge.isPending}
        >
          {label}
          {merge.isPending ? (
            <Spinner />
          ) : (
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              aria-hidden="true"
              className="text-muted-foreground"
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[220px]">
          <DropdownMenuItem
            onClick={() => {
              merge.reset();
              setNaming(true);
            }}
          >
            {editing.speakers.nameOf(speaker) ? "Rename speaker…" : "Name speaker…"}
          </DropdownMenuItem>
          {others.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Merge into</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[200px]">
                {others.map((id) => (
                  <DropdownMenuItem key={id} onClick={() => merge.mutate(id)}>
                    {editing.speakers.label(id)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeError error={merge.error} />
      {naming ? (
        <SpeakerNameDialog editing={editing} speaker={speaker} open onOpenChange={setNaming} />
      ) : null}
    </div>
  );
}

export function PassageSpeakerMenu({
  editing,
  passage,
  className,
}: {
  editing: SpeakerEditing;
  passage: TranscriptPassage;
  className: string;
}) {
  const time = formatDuration(passage.startMs / 1000);
  const assign = useTranscriptChange(editing.mediaId, (speaker: number) =>
    assignSpeaker(editing.mediaId, {
      revision: editing.revision,
      firstWord: passage.firstWord,
      wordCount: passage.words.length,
      speaker,
    }),
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Change speaker of passage at ${time}`}
          aria-busy={assign.isPending}
          disabled={assign.isPending}
          className={className}
        >
          {assign.isPending ? (
            <Spinner />
          ) : (
            <HugeiconsIcon icon={UserSwitchIcon} aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <DropdownMenuRadioGroup
            value={passage.speaker}
            onValueChange={(speaker: number) => assign.mutate(speaker)}
          >
            {editing.speakers.ids.map((id) => (
              <DropdownMenuRadioItem key={id} value={id} closeOnClick>
                {editing.speakers.label(id)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => assign.mutate(editing.speakers.nextId)}>
            <HugeiconsIcon
              icon={UserAdd01Icon}
              aria-hidden="true"
              className="text-muted-foreground"
            />
            New speaker
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeError error={assign.error} />
    </>
  );
}
