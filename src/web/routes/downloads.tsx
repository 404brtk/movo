import { useId } from "react";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { DownloadJob } from "../../shared/contracts/downloads.ts";
import { AccentIcon } from "../components/accent-icon.tsx";
import { DownloadJobRow } from "../components/download-job-row.tsx";
import { DownloadLink } from "../components/download-link.tsx";
import { ListSkeleton } from "../components/list-skeleton.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty.tsx";
import { downloadsOptions } from "../lib/api.ts";
import { isActiveDownload } from "../lib/download-view.ts";

export const Route = createFileRoute("/downloads")({ component: Downloads });

function DownloadSection({ title, jobs }: { title: string; jobs: readonly DownloadJob[] }) {
  const headingId = useId();
  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mt-7 mb-1.5 text-xs/[normal] font-medium text-muted-foreground">
        {title}
      </h2>
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
    <main className="mx-auto max-w-[800px] px-5 pt-9 pb-16">
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
              Paste a YouTube or X link and Movo saves the video or its audio to your library.
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
          />
        </>
      ) : null}
    </main>
  );
}
