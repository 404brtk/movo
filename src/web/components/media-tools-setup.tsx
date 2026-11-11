import { installMediaTools, mediaToolsOptions } from "../lib/api.ts";
import { ToolSetup } from "./tool-setup.tsx";

export function MediaToolsSetup({
  onClose,
  className,
  readyMessage = "You can import files.",
}: {
  onClose: () => void;
  className?: string;
  readyMessage?: string;
}) {
  return (
    <ToolSetup
      id="media-tools-setup"
      title="Media tools are needed"
      readyTitle="Media tools are ready"
      name="media tools"
      description="FFprobe reads imported files and FFmpeg prepares audio for transcription. Movo can download a private copy of both."
      options={mediaToolsOptions}
      install={installMediaTools}
      tools={(status) => ({ FFprobe: status.ffprobe, FFmpeg: status.ffmpeg })}
      provider="an independent FFmpeg build provider"
      manualSetup="Install FFmpeg and FFprobe, add them to PATH or set FFPROBE_PATH and FFMPEG_PATH, then restart Movo."
      readyMessage={readyMessage}
      onClose={onClose}
      className={className}
    />
  );
}
