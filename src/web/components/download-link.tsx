import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  defaultDownloadPreset,
  downloadPresets,
  DownloadPreset,
  getDownloadPreset,
} from "../../shared/contracts/downloads.ts";
import { downloadsOptions, enqueueDownload, previewOptions } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { Button } from "./ui/button.tsx";

export function DownloadLink() {
  const [url, setUrl] = useState("");
  const [checkedUrl, setCheckedUrl] = useState("");
  const [preset, setPreset] = useState<DownloadPreset>(defaultDownloadPreset);
  const [transcribe, setTranscribe] = useState(false);
  const selected = getDownloadPreset(preset);
  const preview = useQuery(previewOptions(checkedUrl));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const download = useMutation({
    mutationFn: enqueueDownload,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey });
      await navigate({ to: "/downloads" });
    },
  });
  const error = preview.error ?? download.error;
  return (
    <section aria-label="Download from a link" className="mb-8 rounded-xl border p-5 sm:p-6">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          download.reset();
          if (checkedUrl === url.trim()) void preview.refetch();
          else setCheckedUrl(url.trim());
        }}
      >
        <label htmlFor="download-url" className="block text-sm font-medium">
          Video link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="download-url"
            name="url"
            type="url"
            required
            maxLength={2048}
            autoComplete="off"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setCheckedUrl("");
              download.reset();
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "download-link-error" : "download-link-help"}
            placeholder="Paste a YouTube or X link"
            className="h-11 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <Button
            type="submit"
            className="h-11 px-4 text-sm"
            disabled={preview.isFetching || download.isPending}
          >
            Check link
          </Button>
        </div>
        <p id="download-link-help" className="text-xs text-muted-foreground">
          Public YouTube videos and X posts with one video. Choose video quality or audio after
          checking the link. Sign-in is not supported.
        </p>
      </form>
      <output className="block text-sm text-muted-foreground">
        {checkedUrl && preview.isFetching
          ? "Checking video details…"
          : download.isPending
            ? "Adding download…"
            : ""}
      </output>
      {checkedUrl && preview.data && !preview.isError ? (
        <div className="mt-5 space-y-4 border-t pt-5">
          <div className="min-w-0 space-y-1">
            <p className="font-medium wrap-anywhere">{preview.data.title}</p>
            <p className="text-sm text-muted-foreground">
              {preview.data.durationSeconds === null
                ? "Duration unknown"
                : formatDuration(preview.data.durationSeconds)}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1 space-y-2">
              <label htmlFor="download-mode" className="block text-sm font-medium">
                Save as
              </label>
              <select
                id="download-mode"
                value={selected.kind}
                disabled={download.isPending}
                onChange={(event) => {
                  setPreset(
                    event.currentTarget.value === "audio" ? "audio" : defaultDownloadPreset,
                  );
                  download.reset();
                }}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="video">Video</option>
                <option value="audio">Audio</option>
              </select>
            </div>
            {selected.kind === "video" ? (
              <div className="min-w-40 flex-1 space-y-2">
                <label htmlFor="download-quality" className="block text-sm font-medium">
                  Video quality
                </label>
                <select
                  id="download-quality"
                  value={preset}
                  disabled={download.isPending}
                  onChange={(event) => {
                    setPreset(Schema.decodeUnknownSync(DownloadPreset)(event.currentTarget.value));
                    download.reset();
                  }}
                  className="h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {downloadPresets
                    .filter((option) => option.kind === "video")
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {selected.kind === "audio"
              ? "Saves the best available audio without keeping video."
              : selected.maxHeight === null
                ? "Uses the highest available resolution. Playback depends on the source codecs."
                : "Limits the video height without upscaling lower-resolution sources. Playback depends on the source codecs."}
          </p>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-h-10 items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={transcribe}
                  disabled={download.isPending}
                  onChange={(event) => {
                    setTranscribe(event.currentTarget.checked);
                    download.reset();
                  }}
                  aria-describedby="download-transcribe-help"
                  className="size-4 shrink-0 accent-primary"
                />
                Transcribe after download
              </label>
              <Button
                className="h-11 px-4 text-sm"
                disabled={download.isPending || preview.isFetching}
                onClick={() => download.mutate({ url: preview.data.url, preset, transcribe })}
              >
                {transcribe ? "Download and transcribe" : "Download"}
              </Button>
            </div>
            <p id="download-transcribe-help" className="text-xs leading-5 text-muted-foreground">
              Uses Parakeet Ultra on this computer. Install the model in{" "}
              <Link to="/models" className="underline underline-offset-4">
                Models
              </Link>{" "}
              and set up FFmpeg before starting.
            </p>
          </div>
        </div>
      ) : null}
      {error ? (
        <p
          id="download-link-error"
          role="alert"
          className="mt-3 text-sm wrap-anywhere text-destructive"
        >
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
