import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { downloadsOptions, enqueueDownload, previewOptions } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { Button } from "./ui/button.tsx";

export function DownloadLink() {
  const [url, setUrl] = useState("");
  const [checkedUrl, setCheckedUrl] = useState("");
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
    <section aria-label="Download a YouTube video" className="mb-8 rounded-xl border p-5 sm:p-6">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          download.reset();
          if (checkedUrl === url.trim()) void preview.refetch();
          else setCheckedUrl(url.trim());
        }}
      >
        <label htmlFor="youtube-url" className="block text-sm font-medium">
          YouTube link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="youtube-url"
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
            placeholder="https://www.youtube.com/watch?v=…"
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
          One public video at a time, up to 1080p. No model download needed.
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
        <div className="mt-5 flex flex-col justify-between gap-4 border-t pt-5 sm:flex-row sm:items-center">
          <div className="min-w-0 space-y-1">
            <p className="font-medium wrap-anywhere">{preview.data.title}</p>
            <p className="text-sm text-muted-foreground">
              {preview.data.durationSeconds === null
                ? "Duration unknown"
                : formatDuration(preview.data.durationSeconds)}
            </p>
          </div>
          <Button
            className="h-11 px-4 text-sm"
            disabled={download.isPending || preview.isFetching}
            onClick={() => download.mutate(preview.data.url)}
          >
            Download
          </Button>
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
