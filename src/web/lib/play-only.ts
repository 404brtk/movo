import { type RefObject, useCallback, useEffect, useRef } from "react";
import { type PlaySegment, playableFrom, playOnlyStep } from "./speaker-filter.ts";

function keepToSegments(
  media: HTMLMediaElement,
  segments: readonly [PlaySegment, ...PlaySegment[]],
  seek: (seconds: number) => void,
  jumping: RefObject<boolean>,
) {
  let frame = 0;
  let landingMs: number | undefined;
  const jumpTo = (milliseconds: number) => {
    landingMs = milliseconds;
    jumping.current = true;
    seek(milliseconds / 1000);
  };
  const keepInside = () => {
    if (media.paused || media.seeking) return;
    const step = playOnlyStep(segments, media.currentTime * 1000, landingMs);
    if (step.kind === "pause") media.pause();
    else if (step.kind === "seek") jumpTo(step.toMs);
  };
  const forgetLandingAfterOtherSeeks = () => {
    if (!jumping.current) landingMs = undefined;
    jumping.current = false;
  };
  const watch = () => {
    keepInside();
    frame = requestAnimationFrame(watch);
  };
  const start = () => {
    if (playableFrom(segments, media.currentTime * 1000) === undefined) jumpTo(segments[0].startMs);
    cancelAnimationFrame(frame);
    watch();
  };
  const stop = () => cancelAnimationFrame(frame);
  media.addEventListener("play", start);
  media.addEventListener("pause", stop);
  media.addEventListener("timeupdate", keepInside);
  media.addEventListener("seeked", forgetLandingAfterOtherSeeks);
  if (!media.paused) start();
  return () => {
    stop();
    jumping.current = false;
    media.removeEventListener("play", start);
    media.removeEventListener("pause", stop);
    media.removeEventListener("timeupdate", keepInside);
    media.removeEventListener("seeked", forgetLandingAfterOtherSeeks);
  };
}

export function usePlayOnly(
  media: HTMLMediaElement | null,
  segments: readonly PlaySegment[] | undefined,
  seek: (seconds: number) => void,
) {
  const jumping = useRef(false);
  useEffect(() => {
    const [first, ...rest] = segments ?? [];
    return media && first ? keepToSegments(media, [first, ...rest], seek, jumping) : undefined;
  }, [media, segments, seek]);
  return useCallback(() => jumping.current, []);
}
