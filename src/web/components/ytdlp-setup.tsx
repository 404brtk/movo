import { installYtdlp, ytdlpOptions } from "../lib/api.ts";
import { ToolSetup } from "./tool-setup.tsx";

export function YtdlpSetup({ onClose }: { onClose: () => void }) {
  return (
    <ToolSetup
      id="ytdlp-setup"
      title="yt-dlp"
      name="yt-dlp"
      description="yt-dlp reads video details and downloads from links. Movo can download a private copy of the official release."
      options={ytdlpOptions}
      install={installYtdlp}
      tools={(status) => ({ "yt-dlp": status.ytdlp })}
      provider="the official project"
      manualSetup="Install the official yt-dlp standalone executable, add it to PATH or set YTDLP_PATH, then restart Movo."
      readyMessage="yt-dlp is ready. You can check the link."
      onClose={onClose}
    />
  );
}
