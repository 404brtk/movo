import { useEffect, useState, useSyncExternalStore } from "react";
import { Schema } from "effect";
import {
  defaultTranscriptExportOptions,
  type Transcript,
  TranscriptExportOptions,
} from "../../shared/contracts/transcriptions.ts";
import { transcriptText } from "../../shared/transcript-export.ts";

const copiedFeedbackMs = 2000;
const exportOptionsKey = "movo.transcript.exportOptions";
const exportOptionsListeners = new Set<() => void>();

function readStoredExportOptions(): TranscriptExportOptions {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(exportOptionsKey) ?? "null");
    return Schema.is(TranscriptExportOptions)(stored) ? stored : defaultTranscriptExportOptions;
  } catch {
    return defaultTranscriptExportOptions;
  }
}

let exportOptions = readStoredExportOptions();

function subscribeToExportOptions(listener: () => void) {
  exportOptionsListeners.add(listener);
  return () => {
    exportOptionsListeners.delete(listener);
  };
}

function storeExportOptions(options: TranscriptExportOptions) {
  try {
    localStorage.setItem(exportOptionsKey, JSON.stringify(options));
  } catch {
    return;
  }
}

export function setExportOptions(change: Partial<TranscriptExportOptions>) {
  exportOptions = { ...exportOptions, ...change };
  storeExportOptions(exportOptions);
  exportOptionsListeners.forEach((listener) => listener());
}

export const useTranscriptExportOptions = () =>
  useSyncExternalStore(subscribeToExportOptions, () => exportOptions);

export const transcriptFormatNames = {
  txt: "Plain text",
  srt: "SubRip subtitles",
  vtt: "WebVTT subtitles",
};

type CopyState = "copying" | "copied" | "failed";

export const copyFailureMessage =
  "Could not copy text. Allow clipboard access in your browser, or download TXT.";

export function useCopyTranscript(transcript: Transcript | null | undefined) {
  const options = useTranscriptExportOptions();
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
      await navigator.clipboard.writeText(transcriptText(copied, options));
      finishCopy(copied, "copied");
    } catch {
      finishCopy(copied, "failed");
    }
  }

  return { state, copyText };
}
