import { type HistoryState, useRouterState } from "@tanstack/react-router";
import { momentHref } from "../../shared/citations.ts";

const nextMoment = (previous: HistoryState): HistoryState => ({
  moment: (previous.moment ?? 0) + 1,
});

export function useMomentNavigation(mediaId: string, startMs: number) {
  const here = useRouterState({
    select: (state) => state.location.href === momentHref(mediaId, startMs),
  });
  return { state: nextMoment, replace: here, resetScroll: false };
}
