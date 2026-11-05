import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getDownloadPreset } from "../../shared/contracts/downloads.ts";
import { cancelDownload, downloadsOptions, retryDownload } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";
import { Button } from "../components/ui/button.tsx";

export const Route = createFileRoute("/downloads")({ component: Downloads });

const phaseLabels = {
  queued: "Waiting",
  checking: "Checking source",
  downloading: "Downloading",
  processing: "Processing media",
  saving: "Saving to library",
  finished: "Finished",
};

function Downloads() {
  const jobs = useQuery(downloadsOptions);
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: ({ id, retry }: { id: string; retry: boolean }) =>
      retry ? retryDownload(id) : cancelDownload(id),
    onSuccess: () => client.invalidateQueries({ queryKey: downloadsOptions.queryKey }),
  });
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-5 py-10 sm:px-8 sm:py-14">
      <div className="space-y-3">
        <Link
          to="/"
          className="inline-flex min-h-10 items-center text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to library
        </Link>
        <h1 className="text-4xl font-semibold tracking-tight">Downloads</h1>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          Downloads continue while you browse other media. Keep the local Movo app running.
          Interrupted downloads can be retried.
        </p>
      </div>
      {jobs.isPending ? <output>Loading downloads…</output> : null}
      {jobs.isError ? (
        <div role="alert" className="space-y-3">
          <p>{jobs.error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void jobs.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {action.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      ) : null}
      {jobs.data?.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
          No downloads yet. Add a YouTube or X link in your library to get started.
        </p>
      ) : null}
      {jobs.data && jobs.data.length > 0 ? (
        <ul aria-label="Download jobs" className="divide-y rounded-xl border px-5">
          {jobs.data.map((job) => {
            const selected = getDownloadPreset(job.preset);
            return (
              <li
                key={job.id}
                className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 space-y-2">
                  <p className="font-medium wrap-anywhere">{job.title ?? job.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.kind === "audio" ? "Audio" : "Video"} · {selected.label}
                  </p>
                  {job.transcribe ? (
                    <p className="text-xs text-muted-foreground">
                      {job.status === "completed"
                        ? "Transcription requested. Open media to view its progress."
                        : "Transcription will be queued after download."}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {job.status === "running"
                      ? phaseLabels[job.phase]
                      : job.status === "queued"
                        ? "Waiting in queue"
                        : job.status === "completed"
                          ? "Saved to library"
                          : job.status === "cancelled"
                            ? "Cancelled"
                            : job.status === "interrupted"
                              ? "Interrupted"
                              : "Download failed"}
                    {job.downloadedBytes > 0 ? ` · ${formatBytes(job.downloadedBytes)}` : ""}
                  </p>
                  {job.error ? (
                    <p className="max-w-xl text-sm wrap-anywhere text-destructive">{job.error}</p>
                  ) : null}
                  {job.cleanupError && job.cleanupError !== job.error ? (
                    <p className="max-w-xl text-sm wrap-anywhere text-destructive">
                      {job.cleanupError}
                    </p>
                  ) : null}
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-8 items-center text-xs text-muted-foreground underline underline-offset-4"
                  >
                    View source
                  </a>
                </div>
                <div className="flex shrink-0 gap-2">
                  {job.status === "completed" && job.mediaId ? (
                    <Link
                      to="/media/$mediaId"
                      params={{ mediaId: job.mediaId }}
                      className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm"
                    >
                      Open media
                    </Link>
                  ) : null}
                  {["queued", "running"].includes(job.status) ? (
                    <Button
                      className="h-11 px-4"
                      variant="outline"
                      disabled={action.isPending || job.phase === "saving"}
                      onClick={() => action.mutate({ id: job.id, retry: false })}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  {["failed", "cancelled", "interrupted"].includes(job.status) ? (
                    <Button
                      className="h-11 px-4"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: job.id, retry: true })}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </main>
  );
}
