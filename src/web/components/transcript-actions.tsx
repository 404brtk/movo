import { Copy01Icon, FileExportIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { transcriptExportFormats, type Transcript } from "../../shared/contracts/transcriptions.ts";
import { transcriptionExportUrl } from "../lib/api.ts";
import {
  copyFailureMessage,
  transcriptFormatNames,
  useCopyTranscript,
} from "../lib/transcript-sharing.ts";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

const swapIconClass =
  "col-start-1 row-start-1 transition-[opacity,scale,filter] duration-200 ease-(--ease-snappy)";
const hiddenIconClass =
  "scale-50 opacity-0 blur-[2px] motion-reduce:scale-100 motion-reduce:blur-none";

export function TranscriptExportItems({ mediaId }: { mediaId: string }) {
  return transcriptExportFormats.map((format) => (
    <DropdownMenuItem
      key={format}
      render={({ children, ...props }) => (
        <a {...props} href={transcriptionExportUrl(mediaId, format)} download>
          {children}
        </a>
      )}
    >
      Download {format.toUpperCase()}
      <span className="ml-auto text-[11.5px] text-muted-foreground">
        {transcriptFormatNames[format]}
      </span>
    </DropdownMenuItem>
  ));
}

export function TranscriptActions({
  mediaId,
  transcript,
}: {
  mediaId: string;
  transcript: Transcript;
}) {
  const { state: copyState, copyText } = useCopyTranscript(transcript);

  return (
    <div className="relative flex items-center">
      <output className="sr-only">{copyState === "copied" ? "Transcript copied." : ""}</output>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" disabled={copyState === "copying"} />}
            aria-label="Copy transcript"
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
          <TooltipContent>Copy transcript</TooltipContent>
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
            <TranscriptExportItems mediaId={mediaId} />
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
