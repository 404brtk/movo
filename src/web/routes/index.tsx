import { FolderLibraryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ImportMedia } from "../components/import-media.tsx";
import { MediaIcon } from "../components/media-icon.tsx";
import { Button } from "../components/ui/button.tsx";
import { mediaListOptions } from "../lib/api.ts";
import { formatBytes, formatDuration, formatImportDate } from "../lib/format.ts";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const library = useQuery(mediaListOptions);
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="mb-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-[-0.045em]">Library</h1>
          <p className="text-sm text-muted-foreground">Audio and video, saved in one place.</p>
        </div>
        <ImportMedia />
      </div>
      {library.isPending ? (
        <output className="block py-12 text-sm text-muted-foreground">Loading your library…</output>
      ) : null}
      {library.isError ? (
        <div role="alert" className="space-y-4 rounded-lg border p-6">
          <p className="text-sm">{library.error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void library.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {library.data?.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="mb-5 text-muted-foreground">
            <HugeiconsIcon icon={FolderLibraryIcon} size={36} aria-hidden="true" />
          </span>
          <h2 className="text-lg font-medium tracking-tight">Your library starts here</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Import an audio or video file to save a copy. Your original stays where it is.
          </p>
          <p className="mt-5 text-xs text-muted-foreground">
            Files up to 10 GiB. No model download needed.
          </p>
        </div>
      ) : null}
      {library.data && library.data.length > 0 ? (
        <section aria-label="Saved media">
          <div className="mb-4 flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>
              {library.data.length} {library.data.length === 1 ? "file" : "files"}
            </p>
            <p>A separate copy of every import</p>
          </div>
          <div
            className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] gap-5 border-y px-4 py-3 text-xs text-muted-foreground md:grid"
            aria-hidden="true"
          >
            <span>File</span>
            <span>Duration</span>
            <span>Size</span>
            <span>Imported</span>
          </div>
          <ul aria-label="Media library" className="divide-y border-b">
            {library.data.map((item) => (
              <li key={item.id}>
                <Link
                  to="/media/$mediaId"
                  params={{ mediaId: item.id }}
                  aria-label={`Open ${item.title}`}
                  className="grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-5 rounded-md px-2 py-4 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] md:px-4"
                >
                  <span className="flex min-w-0 items-center gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <MediaIcon kind={item.kind} />
                    </span>
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.originalName}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDuration(item.durationSeconds)}
                  </span>
                  <span className="hidden text-xs text-muted-foreground tabular-nums md:block">
                    {formatBytes(item.byteSize)}
                  </span>
                  <time
                    className="hidden text-xs text-muted-foreground md:block"
                    dateTime={new Date(item.importedAt).toISOString()}
                  >
                    {formatImportDate(item.importedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
