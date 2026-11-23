import { type HistoryState, useRouterState } from "@tanstack/react-router";
import { momentHref } from "../../shared/citations.ts";

const nextMoment = (previous: HistoryState): HistoryState => ({
  moment: (previous.moment ?? 0) + 1,
});

export function useMomentNavigation(mediaId: string, startMs: number) {
  const open = useRouterState({
    select: (state) => state.location.pathname === momentHref(mediaId),
  });
  const here = useRouterState({
    select: (state) => open && state.location.search.startMs === startMs,
  });
  const speakers = useRouterState({
    select: (state) => (open ? state.location.search.speakers : undefined),
  });
  const only = useRouterState({
    select: (state) => (open ? state.location.search.only : undefined),
  });
  return {
    search: {
      startMs,
      ...(speakers === undefined ? {} : { speakers }),
      ...(only === undefined ? {} : { only }),
    },
    state: nextMoment,
    replace: here,
    resetScroll: false,
  };
}
