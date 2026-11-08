import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { TranscriptChange } from "../../shared/contracts/transcriptions.ts";
import { restoreTranscript, transcriptHistoryOptions } from "../lib/api.ts";
import { formatChangeTime } from "../lib/format.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { Button } from "./ui/button.tsx";

const quoted = (text: string) => `“${text}”`;
const restoredVersion = (target: number, resultRevision: number) =>
  target === resultRevision ? "Restored the transcription result" : `Restored version ${target}`;

function describeChange(change: TranscriptChange, resultRevision: number) {
  if (change.kind === "restore") return restoredVersion(change.restoredRevision, resultRevision);
  const text = !change.before
    ? `Added ${quoted(change.after)}`
    : !change.after
      ? `Removed ${quoted(change.before)}`
      : `${quoted(change.before)} → ${quoted(change.after)}`;
  return change.replacementCount > 1 ? `${text} in ${change.replacementCount} places` : text;
}

export function ChangeHistory({
  mediaId,
  revision,
  resultRevision,
  onClose,
}: {
  mediaId: string;
  revision: number;
  resultRevision: number;
  onClose: () => void;
}) {
  const history = useInfiniteQuery(transcriptHistoryOptions(mediaId, revision));
  const restore = useTranscriptChange(mediaId, (target: number) =>
    restoreTranscript(mediaId, { revision, target }),
  );
  const [restored, setRestored] = useState<number | null>(null);
  const restoreTo = (target: number) =>
    restore.mutate(target, { onSuccess: () => setRestored(target) });
  const changes = history.data?.pages.flatMap((page) => page.changes) ?? [];
  const versions = [
    ...changes.map((change) => ({
      revision: change.revision,
      description: describeChange(change, resultRevision),
      details: `Version ${change.revision} · ${formatChangeTime(change.createdAt)}${change.source === "mcp" ? " · by an AI agent" : ""}`,
    })),
    ...(history.isSuccess && !history.hasNextPage
      ? [
          {
            revision: resultRevision,
            description: "Transcription result",
            details: `Version ${resultRevision}`,
          },
        ]
      : []),
  ];
  return (
    <section aria-labelledby="change-history" className="space-y-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="change-history" className="text-base font-semibold">
          History
        </h3>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="h-10 px-3 text-sm"
            disabled={revision <= resultRevision || restore.isPending}
            onClick={() => restoreTo(revision - 1)}
          >
            Undo last change
          </Button>
          <Button variant="outline" className="h-10 px-3 text-sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <output aria-live="polite" className="block text-sm">
        {restore.isPending
          ? "Restoring…"
          : restored !== null
            ? `${restoredVersion(restored, resultRevision)}.`
            : ""}
      </output>
      {restore.isError ? (
        <p role="alert" className="text-sm wrap-anywhere text-destructive">
          {restore.error.message}
        </p>
      ) : null}
      {history.isPending ? (
        <output className="block text-sm text-muted-foreground">Loading history…</output>
      ) : null}
      {history.isError ? (
        <div role="alert" className="space-y-3 text-sm">
          <p>{history.error.message}</p>
          <Button variant="outline" onClick={() => void history.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {versions.length > 0 ? (
        <ol aria-label="Transcript versions" className="divide-y rounded-md border">
          {versions.map((version) => (
            <li
              key={version.revision}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm wrap-anywhere">{version.description}</p>
                <p className="text-xs text-muted-foreground">{version.details}</p>
              </div>
              {version.revision === revision ? (
                <span className="text-sm text-muted-foreground">Current</span>
              ) : (
                <Button
                  variant="outline"
                  className="h-10 px-3 text-sm"
                  aria-label={`Restore version ${version.revision}`}
                  disabled={restore.isPending}
                  onClick={() => restoreTo(version.revision)}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {history.hasNextPage ? (
        <Button
          variant="outline"
          className="h-10 px-3 text-sm"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Loading…" : "Show older changes"}
        </Button>
      ) : null}
    </section>
  );
}
