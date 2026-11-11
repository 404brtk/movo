import { useEffect, useState } from "react";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { transcriptText } from "../../shared/transcript-export.ts";

const copiedFeedbackMs = 2000;

export const transcriptFormatNames = {
  txt: "Plain text",
  srt: "SubRip subtitles",
  vtt: "WebVTT subtitles",
};

type CopyState = "copying" | "copied" | "failed";

export const copyFailureMessage =
  "Could not copy text. Allow clipboard access in your browser, or download TXT.";

export function useCopyTranscript(transcript: Transcript | null | undefined) {
  const [copy, setCopy] = useState<{ state: CopyState; transcript: Transcript } | null>(null);
  const state = transcript && copy?.transcript === transcript ? copy.state : "idle";

  useEffect(() => {
    if (copy?.state !== "copied") return undefined;
    const timer = setTimeout(() => setCopy(null), copiedFeedbackMs);
    return () => clearTimeout(timer);
  }, [copy]);

  function finishCopy(copied: Transcript, next: "copied" | "failed") {
    setCopy((current) =>
      current?.transcript === copied ? { state: next, transcript: copied } : current,
    );
  }

  async function copyText() {
    if (!transcript) return;
    const copied = transcript;
    setCopy({ state: "copying", transcript: copied });
    try {
      await navigator.clipboard.writeText(transcriptText(copied));
      finishCopy(copied, "copied");
    } catch {
      finishCopy(copied, "failed");
    }
  }

  return { state, copyText };
}
