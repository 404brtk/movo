import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecordingOverview } from "../../shared/contracts/overview.ts";
import { mediaListKey, overviewOptions } from "./api.ts";

const expandedKey = "movo.summary.expanded";

export function useOverviewChange<Input>(
  mediaId: string,
  change: (input: Input) => Promise<RecordingOverview>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: async (overview) => {
      queryClient.setQueryData(overviewOptions(mediaId).queryKey, overview);
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });
}

function readStoredExpanded() {
  try {
    return localStorage.getItem(expandedKey) === "true";
  } catch {
    return false;
  }
}

export function useSummaryExpanded() {
  const [expanded, setExpandedState] = useState(readStoredExpanded);
  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next);
    try {
      localStorage.setItem(expandedKey, String(next));
    } catch {
      return;
    }
  }, []);
  return [expanded, setExpanded] as const;
}
