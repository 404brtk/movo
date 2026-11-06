import { installMediaTools, mediaToolsOptions } from "../lib/api.ts";
import { ToolSetup } from "./tool-setup.tsx";

export function MediaToolsSetup({ onClose }: { onClose: () => void }) {
  return (
    <ToolSetup
      id="media-tools-setup"
      title="Media tools"
      name="media tools"
      description="FFprobe reads imported files. FFmpeg prepares audio for processing. Movo can download a private copy of both tools."
      options={mediaToolsOptions}
      install={installMediaTools}
      tools={(status) => ({ FFprobe: status.ffprobe, FFmpeg: status.ffmpeg })}
      provider="an independent FFmpeg build provider"
      manualSetup="Install FFmpeg and FFprobe, add them to PATH or set FFPROBE_PATH and FFMPEG_PATH, then restart Movo."
      readyMessage="Media tools are ready. You can import a file."
      onClose={onClose}
    />
  );
}
