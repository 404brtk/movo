import { useRef, useState } from "react";
import { Download04Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  defaultDownloadPreset,
  downloadPresets,
  type DownloadPreset,
  getDownloadPreset,
} from "../../shared/contracts/downloads.ts";
import { downloadsOptions, enqueueDownload, previewOptions, ytdlpOptions } from "../lib/api.ts";
import { DownloadBatchCard, DownloadPreviewCard } from "./download-preview-card.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog.tsx";
import { Switch } from "./ui/switch.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { YtdlpSetup } from "./ytdlp-setup.tsx";

const fullWidthOnMobile = "max-sm:w-full max-sm:*:flex-1 max-sm:*:px-0";

const qualityOptions = downloadPresets
  .filter((option) => option.kind === "video")
  .map(
    (option) => [option.id, option.maxHeight === null ? "Best" : `${option.maxHeight}p`] as const,
  );

function describePreset(preset: DownloadPreset) {
  const selected = getDownloadPreset(preset);
  if (selected.kind === "audio") return "Saves the best available audio without keeping video.";
  return selected.maxHeight === null
    ? "Uses the highest available resolution. Playback depends on the source codecs."
    : "Limits the video height without upscaling lower-resolution sources. Playback depends on the source codecs.";
}

export function DownloadLink() {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState("");
  const [checkedUrls, setCheckedUrls] = useState<string[]>([]);
  const [preset, setPreset] = useState<DownloadPreset>(defaultDownloadPreset);
  const [transcribe, setTranscribe] = useState(false);
  const [showYtdlp, setShowYtdlp] = useState(false);
  const checkTrigger = useRef<HTMLButtonElement>(null);
  const ytdlp = useQuery(ytdlpOptions);
  const urls = links.split(/\s+/u).filter(Boolean);
  const previewUrl = checkedUrls.length === 1 ? (checkedUrls[0] ?? "") : "";
  const preview = useQuery(previewOptions(previewUrl));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const download = useMutation({
    mutationFn: enqueueDownload,
    onSuccess: async () => {
      setOpen(false);
      setLinks("");
      setCheckedUrls([]);
      await queryClient.invalidateQueries({ queryKey: downloadsOptions.queryKey });
      await navigate({ to: "/downloads" });
    },
  });
  const checking = previewUrl !== "" && preview.isFetching;
  const error = (preview.error ?? download.error)?.message;
  const ready =
    checkedUrls.length > 1 || (previewUrl !== "" && preview.data !== undefined && !preview.isError);
  const kind = getDownloadPreset(preset).kind;
  const changeOption =
    <Value,>(apply: (value: Value) => void) =>
    (value: Value) => {
      apply(value);
      download.reset();
    };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={Link01Icon} data-icon="inline-start" aria-hidden="true" />
        Download from link
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Download from a link</DialogTitle>
        </DialogHeader>
        <div className="px-5 pt-3.5">
          <form
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
            <label htmlFor="download-url" className="mb-1.5 block text-xs font-medium">
              Video links
            </label>
            <div className="flex items-start gap-2">
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
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  checkTrigger.current?.click();
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "download-link-error" : "download-link-help"}
                placeholder="Paste YouTube or X links, one per line"
                className="max-h-40 min-h-8 min-w-0 flex-1 py-[5px]"
              />
              <Button
                ref={checkTrigger}
                type="submit"
                variant="outline"
                aria-busy={checking}
                aria-controls={showYtdlp ? "ytdlp-setup" : undefined}
                disabled={ytdlp.isPending || preview.isFetching || download.isPending}
              >
                {checking ? <Spinner /> : null}
                {checking ? "Checking…" : urls.length > 1 ? "Check links" : "Check link"}
              </Button>
            </div>
            <p id="download-link-help" className="mt-1.5 text-xs/[17px] text-muted-foreground">
              Public YouTube videos or X posts with one video. Paste several, one per line. Sign-in
              is not supported.
            </p>
          </form>
          <output className="sr-only">
            {checking ? "Checking video details…" : download.isPending ? "Adding download…" : ""}
          </output>
          {showYtdlp ? (
            <YtdlpSetup
              className="mt-4 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--color-border)]"
              onClose={() => {
                setShowYtdlp(false);
                checkTrigger.current?.focus();
              }}
            />
          ) : null}
          {ready ? (
            <>
              {preview.data ? (
                <DownloadPreviewCard preview={preview.data} />
              ) : (
                <DownloadBatchCard count={checkedUrls.length} />
              )}
              <div className="mt-[18px] grid grid-cols-1 items-center gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr] sm:gap-y-3">
                <span className="text-[12.5px] font-medium text-muted-foreground">Save as</span>
                <div>
                  <SegmentedChoice
                    label="Save as"
                    className={fullWidthOnMobile}
                    options={[
                      ["video", "Video"],
                      ["audio", "Audio only"],
                    ]}
                    value={kind}
                    disabled={download.isPending}
                    onValueChange={changeOption((value) =>
                      setPreset(value === "audio" ? "audio" : defaultDownloadPreset),
                    )}
                  />
                </div>
                {kind === "video" ? (
                  <>
                    <span className="text-[12.5px] font-medium text-muted-foreground">Quality</span>
                    <div>
                      <SegmentedChoice
                        label="Quality"
                        className={fullWidthOnMobile}
                        options={qualityOptions}
                        value={preset}
                        disabled={download.isPending}
                        onValueChange={changeOption(setPreset)}
                      />
                    </div>
                  </>
                ) : null}
                <span className="text-[12.5px] font-medium text-muted-foreground">Transcript</span>
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Switch
                    id="download-transcribe"
                    checked={transcribe}
                    disabled={download.isPending}
                    onCheckedChange={changeOption(setTranscribe)}
                  />
                  <label htmlFor="download-transcribe">Transcribe after download</label>
                </div>
              </div>
              <p className="mt-3 text-xs/[17px] text-muted-foreground">{describePreset(preset)}</p>
            </>
          ) : null}
          {error ? (
            <p
              id="download-link-error"
              role="alert"
              className="mt-3 text-[13px]/5 wrap-anywhere text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <p className="text-xs text-muted-foreground">Downloads run one at a time.</p>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              aria-busy={download.isPending}
              disabled={!ready || download.isPending || preview.isFetching}
              onClick={() =>
                download.mutate({
                  urls: preview.data ? [preview.data.url] : checkedUrls,
                  preset,
                  transcribe,
                })
              }
            >
              {download.isPending ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" aria-hidden="true" />
              )}
              {download.isPending
                ? "Adding…"
                : preview.data || !ready
                  ? "Download"
                  : `Download all ${checkedUrls.length}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
