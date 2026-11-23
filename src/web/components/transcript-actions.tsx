import { Copy01Icon, FileExportIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { Schema } from "effect";
import {
  SpeakerNamePlacement,
  speakerNamePlacements,
  transcriptExportFormats,
  type Transcript,
} from "../../shared/contracts/transcriptions.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { transcriptionExportUrl } from "../lib/api.ts";
import {
  copyFailureMessage,
  setExportOptions,
  transcriptFormatNames,
  useCopyTranscript,
  useTranscriptExportOptions,
} from "../lib/transcript-sharing.ts";
import type { SpeakerFilter } from "./speaker-filter.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

const swapIconClass =
  "col-start-1 row-start-1 transition-[opacity,scale,filter] duration-200 ease-(--ease-snappy)";
const hiddenIconClass =
  "scale-50 opacity-0 blur-[2px] motion-reduce:scale-100 motion-reduce:blur-none";

const speakerNamePlacementLabels: Record<SpeakerNamePlacement, string> = {
  turn: "At each turn",
  line: "On every line",
  off: "Off",
};

export function TranscriptExportItems({
  mediaId,
  transcript,
}: {
  mediaId: string;
  transcript: Transcript;
}) {
  const options = useTranscriptExportOptions();
  return (
    <>
      {transcriptExportFormats.map((format) => (
        <DropdownMenuItem
          key={format}
          render={({ children, ...props }) => (
            <a {...props} href={transcriptionExportUrl(mediaId, format, options)} download>
              {children}
            </a>
          )}
        >
          Download {format.toUpperCase()}
          <span className="ml-auto text-[11.5px] text-muted-foreground">
            {transcriptFormatNames[format]}
          </span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      {transcriptSpeakers(transcript).labeled ? (
        <>
          <DropdownMenuRadioGroup
            value={options.speakers}
            onValueChange={(value) =>
              setExportOptions({ speakers: Schema.decodeUnknownSync(SpeakerNamePlacement)(value) })
            }
          >
            <DropdownMenuLabel>Speaker names</DropdownMenuLabel>
            {speakerNamePlacements.map((placement) => (
              <DropdownMenuRadioItem key={placement} value={placement}>
                {speakerNamePlacementLabels[placement]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuCheckboxItem
        checked={options.timestamps}
        onCheckedChange={(timestamps) => setExportOptions({ timestamps })}
      >
        Timestamps in TXT
      </DropdownMenuCheckboxItem>
    </>
  );
}

export function TranscriptActions({
  mediaId,
  transcript,
  filter,
}: {
  mediaId: string;
  transcript: Transcript;
  filter: Pick<SpeakerFilter, "chosen" | "owner">;
}) {
  const { chosen, owner } = filter;
  const { state: copyState, copyText } = useCopyTranscript(transcript, chosen);
  const copyLabel = owner === undefined ? "Copy transcript" : `Copy ${owner} passages`;

  return (
    <div className="relative flex items-center">
      <output className="sr-only">
        {copyState === "copied"
          ? owner === undefined
            ? "Transcript copied."
            : "Passages copied."
          : ""}
      </output>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" disabled={copyState === "copying"} />}
            aria-label={copyLabel}
            aria-busy={copyState === "copying" || undefined}
            onClick={() => void copyText()}
          >
            <span className="grid">
              <HugeiconsIcon
                icon={Copy01Icon}
                aria-hidden="true"
                className={cn(swapIconClass, copyState === "copied" && hiddenIconClass)}
              />
              <HugeiconsIcon
                icon={Tick02Icon}
                aria-hidden="true"
                className={cn(
                  swapIconClass,
                  "text-success",
                  copyState !== "copied" && hiddenIconClass,
                )}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{copyLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" className="-mr-1.5" />}
                />
              }
              aria-label="Export transcript"
            >
              <HugeiconsIcon icon={FileExportIcon} aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Export transcript</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <TranscriptExportItems mediaId={mediaId} transcript={transcript} />
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
      {copyState === "failed" ? (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-64 text-right text-xs text-destructive"
        >
          {copyFailureMessage}
        </p>
      ) : null}
    </div>
  );
}
