import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  defaultDownloadPreset,
  downloadPresets,
  DownloadPreset,
  getDownloadPreset,
} from "../../shared/contracts/downloads.ts";
import { downloadsOptions, enqueueDownload, previewOptions, ytdlpOptions } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";
import { YtdlpSetup } from "./ytdlp-setup.tsx";

export function DownloadLink() {
  const [links, setLinks] = useState("");
  const [checkedUrls, setCheckedUrls] = useState<string[]>([]);
  const [preset, setPreset] = useState<DownloadPreset>(defaultDownloadPreset);
  const [transcribe, setTranscribe] = useState(false);
  const [showYtdlp, setShowYtdlp] = useState(false);
  const checkTrigger = useRef<HTMLButtonElement>(null);
  const ytdlp = useQuery(ytdlpOptions);
  const selected = getDownloadPreset(preset);
  const urls = links.split(/\s+/u).filter(Boolean);
  const previewUrl = checkedUrls.length === 1 ? (checkedUrls[0] ?? "") : "";
  const preview = useQuery(previewOptions(previewUrl));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const download = useMutation({
    mutationFn: enqueueDownload,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey });
      await navigate({ to: "/downloads" });
    },
  });
  const error = (preview.error ?? download.error)?.message;
  const ready =
    checkedUrls.length > 1 || (previewUrl !== "" && preview.data !== undefined && !preview.isError);
  return (
    <section aria-label="Download from a link" className="mb-8 rounded-xl border p-5 sm:p-6">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          download.reset();
          if (ytdlp.data?.ytdlp.state !== "ready") {
            setShowYtdlp(true);
            return;
          }
          setShowYtdlp(false);
          if (urls.length === 1 && previewUrl === urls[0]) void preview.refetch();
          else setCheckedUrls(urls);
        }}
      >
        <label htmlFor="download-url" className="block text-sm font-medium">
          Video links
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Textarea
            id="download-url"
            name="urls"
            required
            rows={1}
            autoComplete="off"
            spellCheck={false}
            value={links}
            onChange={(event) => {
              setLinks(event.target.value);
              setCheckedUrls([]);
              download.reset();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              checkTrigger.current?.click();
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "download-link-error" : "download-link-help"}
            placeholder="Paste YouTube or X links, one per line"
            className="max-h-60 min-h-11 min-w-0 flex-1 resize-y"
          />
          <Button
            ref={checkTrigger}
            type="submit"
            className="h-11 px-4 text-sm"
            aria-controls={showYtdlp ? "ytdlp-setup" : undefined}
            disabled={ytdlp.isPending || preview.isFetching || download.isPending}
          >
            {urls.length > 1 ? "Check links" : "Check link"}
          </Button>
        </div>
        <p id="download-link-help" className="text-xs text-muted-foreground">
          Public YouTube videos or X posts with one video, separated by spaces or new lines
          (Shift+Enter). Choose video quality or audio after checking. Sign-in is not supported.
        </p>
      </form>
      <output className="block text-sm text-muted-foreground">
        {previewUrl && preview.isFetching
          ? "Checking video details…"
          : download.isPending
            ? "Adding download…"
            : ""}
      </output>
      {showYtdlp ? (
        <YtdlpSetup
          onClose={() => {
            setShowYtdlp(false);
            checkTrigger.current?.focus();
          }}
        />
      ) : null}
      {ready ? (
        <div className="mt-5 space-y-4 border-t pt-5">
          {preview.data ? (
            <div className="min-w-0 space-y-1">
              <p className="font-medium wrap-anywhere">{preview.data.title}</p>
              <p className="text-sm text-muted-foreground">
                {preview.data.durationSeconds === null
                  ? "Duration unknown"
                  : formatDuration(preview.data.durationSeconds)}
              </p>
            </div>
          ) : (
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{checkedUrls.length} links</p>
              <p className="text-sm text-muted-foreground">
                Movo checks each link when its download starts. Downloads run one at a time.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1 space-y-2">
              <label htmlFor="download-mode" className="block text-sm font-medium">
                Save as
              </label>
              <NativeSelect
                id="download-mode"
                value={selected.kind}
                disabled={download.isPending}
                onChange={(event) => {
                  setPreset(
                    event.currentTarget.value === "audio" ? "audio" : defaultDownloadPreset,
                  );
                  download.reset();
                }}
                className="w-full"
              >
                <NativeSelectOption value="video">Video</NativeSelectOption>
                <NativeSelectOption value="audio">Audio</NativeSelectOption>
              </NativeSelect>
            </div>
            {selected.kind === "video" ? (
              <div className="min-w-40 flex-1 space-y-2">
                <label htmlFor="download-quality" className="block text-sm font-medium">
                  Video quality
                </label>
                <NativeSelect
                  id="download-quality"
                  value={preset}
                  disabled={download.isPending}
                  onChange={(event) => {
                    setPreset(Schema.decodeUnknownSync(DownloadPreset)(event.currentTarget.value));
                    download.reset();
                  }}
                  className="w-full"
                >
                  {downloadPresets
                    .filter((option) => option.kind === "video")
                    .map((option) => (
                      <NativeSelectOption key={option.id} value={option.id}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
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
                onClick={() =>
                  download.mutate({
                    urls: preview.data ? [preview.data.url] : checkedUrls,
                    preset,
                    transcribe,
                  })
                }
              >
                {transcribe ? "Download and transcribe" : "Download"}
                {preview.data ? "" : ` all ${checkedUrls.length}`}
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
          {error}
        </p>
      ) : null}
    </section>
  );
}
