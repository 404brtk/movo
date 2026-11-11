import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, importMedia, mediaItemOptions, mediaListKey, mediaToolsOptions } from "./api.ts";

export type ImportEntry = { id: number; file: File; error: string | null };
export type ImportOutcome = "toolsMissing" | "cancelled" | "rejected" | "imported";

const fileRejectionStatuses = new Set([400, 413, 415]);

const whenAborted = (signal: AbortSignal) =>
  new Promise<"cancelled">((resolve) =>
    signal.addEventListener("abort", () => resolve("cancelled"), { once: true }),
  );

export function useMediaImport() {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<readonly ImportEntry[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const nextId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const importing = useMutation({
    mutationFn: async ({
      queue,
      transcribe,
    }: {
      queue: readonly ImportEntry[];
      transcribe: boolean;
    }): Promise<ImportOutcome> => {
      const abort = new AbortController();
      controller.current = abort;
      const tools = await Promise.race([
        queryClient.fetchQuery({ ...mediaToolsOptions, staleTime: 0 }),
        whenAborted(abort.signal),
      ]);
      if (tools === "cancelled") return "cancelled";
      const requiredTools = transcribe ? [tools.ffprobe, tools.ffmpeg] : [tools.ffprobe];
      if (requiredTools.some((tool) => tool.state !== "ready")) return "toolsMissing";
      let rejected = false;
      for (const entry of queue) {
        setCurrentId(entry.id);
        try {
          const item = await importMedia(entry.file, { transcribe, signal: abort.signal });
          setEntries((current) => current.filter(({ id }) => id !== entry.id));
          queryClient.setQueryData(mediaItemOptions(item.id).queryKey, item);
          void queryClient.invalidateQueries({ queryKey: mediaListKey });
        } catch (error) {
          if (abort.signal.aborted) return "cancelled";
          if (!(error instanceof ApiError && fileRejectionStatuses.has(error.status))) throw error;
          rejected = true;
          const { message } = error;
          setEntries((current) =>
            current.map((item) => (item.id === entry.id ? { ...item, error: message } : item)),
          );
        }
      }
      return rejected ? "rejected" : "imported";
    },
    onSettled: () => {
      setCurrentId(null);
      controller.current = null;
    },
  });
  const pending = importing.isPending;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    if (pending) window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [pending]);

  const queue = importing.variables?.queue ?? [];
  return {
    entries,
    currentId,
    position: pending ? queue.findIndex(({ id }) => id === currentId) + 1 : 0,
    total: queue.length,
    pending,
    error: importing.error,
    add: (files: Iterable<File>) => {
      const added = Array.from(files, (file) => ({ id: nextId.current++, file, error: null }));
      setEntries((current) => [...current, ...added]);
    },
    remove: (id: number) => setEntries((current) => current.filter((entry) => entry.id !== id)),
    start: (transcribe: boolean, onOutcome: (outcome: ImportOutcome) => void) => {
      setEntries((current) => current.map((entry) => ({ ...entry, error: null })));
      importing.mutate({ queue: entries, transcribe }, { onSuccess: onOutcome });
    },
    cancel: () => controller.current?.abort(),
  };
}
