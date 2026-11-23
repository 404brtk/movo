import { useEffect } from "react";
import { type PlaySegment, playableFrom, playOnlyStep } from "./speaker-filter.ts";

export function usePlayOnly(
  media: HTMLMediaElement | null,
  segments: readonly PlaySegment[] | undefined,
  seek: (seconds: number) => void,
) {
  useEffect(() => {
    const first = segments?.[0];
    if (!media || !segments || !first) return undefined;
    let frame = 0;
    let landingMs: number | undefined;
    let jumping = false;
    const jumpTo = (milliseconds: number) => {
      landingMs = milliseconds;
      jumping = true;
      seek(milliseconds / 1000);
    };
    const keepInside = () => {
      if (media.paused || media.seeking) return;
      const step = playOnlyStep(segments, media.currentTime * 1000, landingMs);
      if (step.kind === "pause") media.pause();
      else if (step.kind === "seek") jumpTo(step.toMs);
    };
    const forgetLandingAfterOtherSeeks = () => {
      if (!jumping) landingMs = undefined;
      jumping = false;
    };
    const watch = () => {
      keepInside();
      frame = requestAnimationFrame(watch);
    };
    const start = () => {
      if (playableFrom(segments, media.currentTime * 1000) === undefined) jumpTo(first.startMs);
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
      media.removeEventListener("play", start);
      media.removeEventListener("pause", stop);
      media.removeEventListener("timeupdate", keepInside);
      media.removeEventListener("seeked", forgetLandingAfterOtherSeeks);
    };
  }, [media, segments, seek]);
}
