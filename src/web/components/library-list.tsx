import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LibraryItem, LibrarySort } from "../../shared/contracts/library.ts";
import {
  enqueueTranscription,
  mediaListKey,
  retryTranscription,
  transcriptionOptions,
} from "../lib/api.ts";
import { describeMedia, groupByImportPeriod } from "../lib/library-view.ts";
import { MediaRow } from "./media-row.tsx";
import { Spinner } from "./spinner.tsx";
import { TranscriptionStatus } from "./transcription-status.tsx";
import { Button } from "./ui/button.tsx";

function LibraryRow({ item }: { item: LibraryItem }) {
  const queryClient = useQueryClient();
  const transcribe = useMutation({
    mutationFn: () =>
      item.transcription === "stopped"
        ? retryTranscription(item.id)
        : enqueueTranscription(item.id),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: transcriptionOptions(item.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: mediaListKey }),
      ]),
  });
  const canTranscribe =
    (item.transcription === "none" || item.transcription === "stopped") &&
    item.fileRemovedAt === null;
  return (
    <MediaRow
      item={item}
      title={item.title}
      details={
        transcribe.isError ? (
          <span role="alert" className="text-destructive">
            {transcribe.error.message}
          </span>
        ) : (
          describeMedia(item, { detailed: true })
        )
      }
      status={
        canTranscribe ? (
          <Button
            variant="outline"
            size="sm"
            aria-busy={transcribe.isPending}
            disabled={transcribe.isPending}
            onClick={() => transcribe.mutate()}
          >
            {transcribe.isPending ? <Spinner /> : null}
            {transcribe.isPending ? "Starting…" : "Transcribe"}
          </Button>
        ) : (
          <TranscriptionStatus transcription={item.transcription} />
        )
      }
      className="h-15 hover:bg-subtle"
    />
  );
}

export function LibraryList({ items, sort }: { items: readonly LibraryItem[]; sort: LibrarySort }) {
  const groups =
    sort === "title" || sort === "relevance"
      ? [{ label: null, items }]
      : groupByImportPeriod(items);
  return (
    <section aria-label="Media library" className={groups[0]?.label ? undefined : "mt-5"}>
      {groups.map((group, index) => (
        <div key={index}>
          {group.label ? (
            <h2 className="mt-[26px] mb-1.5 text-xs/[normal] font-medium text-muted-foreground">
              {group.label}
            </h2>
          ) : null}
          <ul className="-mx-2.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <LibraryRow item={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
