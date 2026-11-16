import { type ReactNode, useId } from "react";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { DownloadJob } from "../../shared/contracts/downloads.ts";
import { AccentIcon } from "../components/accent-icon.tsx";
import { BackToLibrary } from "../components/back-to-library.tsx";
import { DownloadJobRow } from "../components/download-job-row.tsx";
import { DownloadLink } from "../components/download-link.tsx";
import { ListSkeleton } from "../components/list-skeleton.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Spinner } from "../components/spinner.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty.tsx";
import { clearDownloads, downloadPreviewKey, downloadsOptions } from "../lib/api.ts";
import { isActiveDownload } from "../lib/download-view.ts";

export const Route = createFileRoute("/downloads")({ component: Downloads });

function ClearHistory() {
  const queryClient = useQueryClient();
  const clear = useMutation({
    mutationFn: clearDownloads,
    onSuccess: (jobs) => {
      queryClient.setQueryData(downloadsOptions.queryKey, jobs);
      void queryClient.invalidateQueries({ queryKey: downloadPreviewKey });
      document.querySelector<HTMLElement>("[data-download-link-trigger]")?.focus();
    },
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="-my-1.5 -mr-2.5"
        aria-label="Clear recent downloads"
        aria-busy={clear.isPending}
        disabled={clear.isPending}
        onClick={() => clear.mutate()}
      >
        {clear.isPending ? <Spinner /> : null}
        {clear.isPending ? "Clearing…" : "Clear"}
      </Button>
      {clear.isError ? (
        <p role="alert" className="text-right text-xs text-destructive">
          {clear.error.message}
        </p>
      ) : null}
    </div>
  );
}

function DownloadSection({
  title,
  jobs,
  action,
}: {
  title: string;
  jobs: readonly DownloadJob[];
  action?: ReactNode;
}) {
  const headingId = useId();
  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <div className="mt-7 mb-1.5 flex items-start justify-between gap-4">
        <h2 id={headingId} className="text-xs/[normal] font-medium text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      <ul aria-labelledby={headingId}>
        {jobs.map((job) => (
          <DownloadJobRow key={job.id} job={job} />
        ))}
      </ul>
    </section>
  );
}

function Downloads() {
  const jobs = useQuery(downloadsOptions);
  return (
    <main className="mx-auto max-w-[800px] px-5 pt-5 pb-16">
      <div className="mb-3 -ml-2.5">
        <BackToLibrary />
      </div>
      <PageHeader
        title="Downloads"
        description="Downloads keep running while you browse. Keep Movo open until they finish."
      >
        <DownloadLink />
      </PageHeader>
      {jobs.isPending ? <ListSkeleton label="Loading downloads" /> : null}
      {jobs.isError ? (
        <div role="alert" className="mt-8 space-y-4 rounded-lg border p-6">
          <p className="text-sm">{jobs.error.message}</p>
          <Button variant="outline" onClick={() => void jobs.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {jobs.data?.length === 0 ? (
        <Empty className="mt-[88px] gap-0 p-0">
          <EmptyHeader className="max-w-[360px] gap-0">
            <EmptyMedia className="mb-0">
              <AccentIcon icon={Download04Icon} size={30} />
            </EmptyMedia>
            <EmptyTitle className="mt-4 text-[17px]/6 font-semibold tracking-[-0.01em]">
              No downloads yet
            </EmptyTitle>
            <EmptyDescription className="mt-1.5 text-[13.5px]/[21px] text-pretty">
              Paste a video or podcast link and Movo saves the recording to your library.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {jobs.data ? (
        <>
          <DownloadSection title="In progress" jobs={jobs.data.filter(isActiveDownload)} />
          <DownloadSection
            title="Recent"
            jobs={jobs.data.filter((job) => !isActiveDownload(job))}
            action={<ClearHistory />}
          />
        </>
      ) : null}
    </main>
  );
}
