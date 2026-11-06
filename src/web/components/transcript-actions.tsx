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
