import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activeInstallationPhases } from "../../shared/contracts/media-tools.ts";
import { installMediaTools, mediaToolsOptions } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";
import { Button } from "./ui/button.tsx";

export function MediaToolsSetup({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const tools = useQuery(mediaToolsOptions);
  const install = useMutation({
    mutationFn: installMediaTools,
    onSuccess: (status) => queryClient.setQueryData(mediaToolsOptions.queryKey, status),
  });
  const status = tools.data;
  const busy =
    install.isPending || activeInstallationPhases.includes(status?.installation.phase ?? "");
  const ready = status?.ffprobe.state === "ready" && status.ffmpeg.state === "ready";
  const configuredError =
    status &&
    [status.ffprobe, status.ffmpeg].find(
      (tool) => tool.state === "broken" && tool.source === "configured",
    );
  const failure = install.error?.message ?? tools.error?.message ?? status?.installation.error;
  const phase = status?.installation.phase;
  const announcement =
    phase === "downloading"
      ? "Downloading media tools…"
      : phase === "verifying"
        ? "Verifying download…"
        : phase === "extracting"
          ? "Unpacking media tools…"
          : phase === "validating"
            ? "Checking media tools…"
            : ready
              ? "Media tools are ready. You can import a file."
              : "";

  return (
    <section
      id="media-tools-setup"
      aria-labelledby="media-tools-heading"
      className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-5 text-left text-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="media-tools-heading" className="font-medium">
          Media tools
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="leading-6 text-muted-foreground">
        FFprobe reads imported files. FFmpeg prepares audio for processing. Movo can download a
        private copy of both tools.
      </p>
      {status ? (
        <ul className="space-y-2">
          {(["ffprobe", "ffmpeg"] as const).map((name) => {
            const tool = status[name];
            return (
              <li key={name}>
                <span className="font-medium">{name === "ffprobe" ? "FFprobe" : "FFmpeg"}: </span>
                {tool.state === "ready"
                  ? `Ready · ${tool.version} · ${tool.source}`
                  : tool.state === "broken"
                    ? tool.message
                    : "Not found"}
              </li>
            );
          })}
        </ul>
      ) : null}
      {status?.download && !ready ? (
        <p className="text-muted-foreground">
          Download: {formatBytes(status.download.bytes)} · version {status.download.version}. Built
          by{" "}
          <a
            className="underline underline-offset-4"
            href={status.download.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {status.download.provider}
          </a>
          , an independent FFmpeg build provider. Saved in Movo’s data folder.
        </p>
      ) : null}
      {status && !status.download && !ready ? (
        <p>
          Automatic downloads are unavailable on this platform. Install FFmpeg and FFprobe, add them
          to PATH or set FFPROBE_PATH and FFMPEG_PATH, then restart Movo.
        </p>
      ) : null}
      <output className="block text-muted-foreground">{announcement}</output>
      {busy && status?.download ? (
        <div className="space-y-2">
          <progress
            aria-label="Media tools download"
            className="h-2 w-full accent-primary"
            value={status.installation.downloadedBytes}
            max={status.download.bytes}
          />
          <p className="text-xs text-muted-foreground">
            {formatBytes(status.installation.downloadedBytes)} of{" "}
            {formatBytes(status.download.bytes)}. You can close this panel; the download continues.
          </p>
        </div>
      ) : null}
      {failure ? (
        <p role="alert" className="wrap-anywhere text-destructive">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status?.download && !ready && !configuredError ? (
          <Button className="h-10 px-3" disabled={busy} onClick={() => install.mutate()}>
            {busy ? "Preparing tools…" : failure ? "Retry download" : "Download media tools"}
          </Button>
        ) : null}
        {!busy ? (
          <Button
            className="h-10 px-3"
            variant="outline"
            onClick={() => {
              install.reset();
              void tools.refetch();
            }}
          >
            Check again
          </Button>
        ) : null}
      </div>
    </section>
  );
}
