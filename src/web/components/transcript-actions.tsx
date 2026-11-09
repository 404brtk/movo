import { useState } from "react";
import { Copy01Icon, FileExportIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { transcriptExportFormats, type Transcript } from "../../shared/contracts/transcriptions.ts";
import { transcriptText } from "../../shared/transcript-export.ts";
import { transcriptionExportUrl } from "../lib/api.ts";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

const formatNames = { txt: "Plain text", srt: "SubRip subtitles", vtt: "WebVTT subtitles" };

export function TranscriptActions({
  mediaId,
  transcript,
}: {
  mediaId: string;
  transcript: Transcript;
}) {
  const [copy, setCopy] = useState<{
    state: "copying" | "copied" | "failed";
    transcript: Transcript;
  } | null>(null);
  const copyState = copy?.transcript === transcript ? copy.state : "idle";

  async function copyText() {
    const copied = transcript;
    setCopy({ state: "copying", transcript: copied });
    try {
      await navigator.clipboard.writeText(transcriptText(copied));
      finishCopy(copied, "copied");
    } catch {
      finishCopy(copied, "failed");
    }
  }

  function finishCopy(copied: Transcript, state: "copied" | "failed") {
    setCopy((current) =>
      current?.transcript === copied ? { state, transcript: copied } : current,
    );
  }

  return (
    <div className="relative flex items-center">
      <output className="sr-only">{copyState === "copied" ? "Transcript copied." : ""}</output>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy transcript"
        disabled={copyState === "copying"}
        onClick={() => void copyText()}
      >
        <HugeiconsIcon
          icon={copyState === "copied" ? Tick02Icon : Copy01Icon}
          aria-hidden="true"
          className={copyState === "copied" ? "text-success" : undefined}
        />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="-mr-1.5" />}
          aria-label="Export transcript"
        >
          <HugeiconsIcon icon={FileExportIcon} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {transcriptExportFormats.map((format) => (
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
                {formatNames[format]}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {copyState === "failed" ? (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-64 text-right text-xs text-destructive"
        >
          Could not copy text. Allow clipboard access in your browser, or download TXT.
        </p>
      ) : null}
    </div>
  );
}
