import { type HistoryState, useRouter, useRouterState } from "@tanstack/react-router";
import { momentHref } from "../../shared/citations.ts";

const nextMoment = (previous: HistoryState): HistoryState => ({
  moment: (previous.moment ?? 0) + 1,
});

export function useMomentNavigation(mediaId: string, startMs: number) {
  const router = useRouter();
  const open = useRouterState({
    select: (state) => state.location.pathname === momentHref(mediaId),
  });
  const speakers = useRouterState({
    select: (state) => (open ? state.location.search.speakers : undefined),
  });
  const only = useRouterState({
    select: (state) => (open ? state.location.search.only : undefined),
  });
  const search = {
    startMs,
    ...(speakers === undefined ? {} : { speakers }),
    ...(only === undefined ? {} : { only }),
  };
  const { href } = router.buildLocation({ to: "/media/$mediaId", params: { mediaId }, search });
  const here = useRouterState({ select: (state) => state.location.href === href });
  return { search, state: nextMoment, replace: here, resetScroll: false };
}
