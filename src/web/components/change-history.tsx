import { useState } from "react";
import { Clock01Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { TranscriptChange } from "../../shared/contracts/transcriptions.ts";
import { restoreTranscript, transcriptHistoryOptions } from "../lib/api.ts";
import { formatDuration } from "../lib/format.ts";
import { formatDayAndTime } from "../lib/library-view.ts";
import { useTranscriptChange } from "../lib/transcript-change.ts";
import { cn } from "../lib/utils.ts";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet.tsx";

const quoted = (text: string) => `“${text}”`;
const restoredVersion = (target: number, resultRevision: number) =>
  target === resultRevision ? "Restored the transcription result" : `Restored version ${target}`;

function describeChange(change: TranscriptChange, resultRevision: number) {
  if (change.kind === "restore") return restoredVersion(change.restoredRevision, resultRevision);
  if (change.kind === "replace")
    return change.after
      ? `Replaced ${quoted(change.before)} with ${quoted(change.after)}`
      : `Removed ${quoted(change.before)}`;
  const at = change.startMs === null ? "" : ` at ${formatDuration(change.startMs / 1000)}`;
  if (!change.before) return `Added a passage${at}`;
  return change.after ? `Edited passage${at}` : `Removed passage${at}`;
}

function describeDetails(change: TranscriptChange) {
  const count =
    change.kind === "replace"
      ? `${change.replacementCount} ${change.replacementCount === 1 ? "replacement" : "replacements"} · `
      : "";
  const agent = change.source === "mcp" ? " · by an AI agent" : "";
  return `${count}${formatDayAndTime(change.createdAt)}${agent}`;
}

function HistoryVersions({
  mediaId,
  revision,
  resultRevision,
  modelName,
}: {
  mediaId: string;
  revision: number;
  resultRevision: number;
  modelName: string;
}) {
  const history = useInfiniteQuery(transcriptHistoryOptions(mediaId, revision));
  const restore = useTranscriptChange(mediaId, (target: number) =>
    restoreTranscript(mediaId, { revision, target }),
  );
  const [restored, setRestored] = useState<number | null>(null);
  const changes = history.data?.pages.flatMap((page) => page.changes) ?? [];
  const versions = [
    ...changes.map((change) => ({
      revision: change.revision,
      description: describeChange(change, resultRevision),
      details: describeDetails(change),
    })),
    ...(history.isSuccess && !history.hasNextPage
      ? [{ revision: resultRevision, description: "Transcription result", details: modelName }]
      : []),
  ];
  return (
    <>
      <output aria-live="polite" className="sr-only">
        {restored !== null ? `${restoredVersion(restored, resultRevision)}.` : ""}
      </output>
      {restore.isError ? (
        <p role="alert" className="mx-5 mt-3 text-xs wrap-anywhere text-destructive">
          {restore.error.message}
        </p>
      ) : null}
      {history.isPending ? (
        <output className="mx-5 mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          Loading history…
        </output>
      ) : null}
      {history.isError ? (
        <div role="alert" className="mx-5 mt-4 space-y-3 text-xs">
          <p>{history.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void history.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {versions.length > 0 ? (
        <ol aria-label="Transcript versions" className="px-3 pt-3">
          {versions.map((version) => {
            const current = version.revision === revision;
            const restoring = restore.isPending && restore.variables === version.revision;
            return (
              <li
                key={version.revision}
                className="group/version relative grid grid-cols-[20px_1fr_auto] items-start gap-2.5 rounded-[10px] px-2 py-2.5 before:absolute before:top-6 before:-bottom-3 before:left-[17.5px] before:w-px before:bg-input last:before:hidden hover:bg-subtle"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 mt-1 ml-[5px] size-[9px] rounded-full bg-background shadow-[inset_0_0_0_1.5px_var(--color-border-strong)]",
                    current &&
                      "bg-linear-to-b from-primary-from to-primary-to shadow-[0_0_0_3px_var(--color-highlight)]",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[13px]/[19px] font-medium wrap-anywhere">
                    {version.description}
                  </p>
                  <p className="mt-px text-xs text-muted-foreground">{version.details}</p>
                </div>
                {current ? (
                  <span className="rounded-md bg-tint px-[7px] py-[3px] text-[11.5px] font-medium text-primary-strong">
                    Current
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Restore version ${version.revision}`}
                    aria-busy={restoring}
                    disabled={restore.isPending}
                    onClick={() =>
                      restore.mutate(version.revision, {
                        onSuccess: () => setRestored(version.revision),
                      })
                    }
                  >
                    {restoring ? (
                      <Spinner />
                    ) : (
                      <HugeiconsIcon
                        icon={Undo02Icon}
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                    )}
                    {restoring ? "Restoring…" : "Restore"}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      {history.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="mx-5 mt-2 self-start"
          aria-busy={history.isFetchingNextPage}
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? <Spinner /> : null}
          {history.isFetchingNextPage ? "Loading…" : "Show older changes"}
        </Button>
      ) : null}
    </>
  );
}

export function ChangeHistory(props: {
  mediaId: string;
  revision: number;
  resultRevision: number;
  modelName: string;
}) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="toggle" size="sm" />}>
        <HugeiconsIcon icon={Clock01Icon} data-icon="inline-start" aria-hidden="true" />
        History
      </SheetTrigger>
      <SheetContent>
        <SheetHeader closeLabel="Close history">
          <SheetTitle>History</SheetTitle>
        </SheetHeader>
        <SheetDescription>
          Every edit is a version. Restoring adds a new one, so nothing is lost.
        </SheetDescription>
        <HistoryVersions {...props} />
      </SheetContent>
    </Sheet>
  );
}
