import type { LibraryTranscription } from "../../shared/contracts/library.ts";
import type { StatusTone } from "../lib/status-tone.ts";
import { StatusIndicator } from "./status-indicator.tsx";

const appearances: Record<LibraryTranscription, readonly [tone: StatusTone, label: string]> = {
  active: ["active", "Transcribing"],
  done: ["success", "Transcribed"],
  none: ["idle", "Not yet"],
  stopped: ["idle", "Not yet"],
};

export function TranscriptionStatus({ transcription }: { transcription: LibraryTranscription }) {
  const [tone, label] = appearances[transcription];
  return (
    <StatusIndicator tone={tone}>
      <span className="max-sm:sr-only">{label}</span>
    </StatusIndicator>
  );
}
