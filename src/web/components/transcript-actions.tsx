import { useState } from "react";
import { transcriptExportFormats, type Transcript } from "../../shared/contracts/transcriptions.ts";
import { transcriptText } from "../../shared/transcript-export.ts";
import { transcriptionExportUrl } from "../lib/api.ts";
import { Button, buttonVariants } from "./ui/button.tsx";

export function TranscriptActions({
  mediaId,
  transcript,
}: {
  mediaId: string;
  transcript: Transcript;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  async function copyText() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(transcriptText(transcript));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-10 px-3 text-sm"
          disabled={copyState === "copying"}
          onClick={() => {
            void copyText();
          }}
        >
          Copy text
        </Button>
        {transcriptExportFormats.map((format) => (
          <a
            key={format}
            href={transcriptionExportUrl(mediaId, format)}
            download
            className={buttonVariants({ variant: "outline", className: "h-10 px-3 text-sm" })}
          >
            Download {format.toUpperCase()}
          </a>
        ))}
      </div>
      <output className="block text-sm text-muted-foreground">
        {copyState === "copied" ? "Transcript copied." : ""}
      </output>
      {copyState === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          Could not copy text. Allow clipboard access in your browser, or download TXT.
        </p>
      ) : null}
    </div>
  );
}
