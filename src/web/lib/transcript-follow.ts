import { type RefObject, useEffect, useRef, useState } from "react";

const scrollKeys = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);
const middleButton = 1;
const editableTargets = "input, textarea, select, [contenteditable]";

const scrollsPage = (event: KeyboardEvent) =>
  !event.defaultPrevented &&
  scrollKeys.has(event.key) &&
  !(event.target instanceof Element && event.target.closest(editableTargets)) &&
  !(event.key === " " && event.target instanceof HTMLButtonElement);

export const pinnedHeight = () =>
  Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;

const scrollBehavior = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export function useTranscriptFollow({
  list,
  passage,
  following,
  suspended,
  onFollowingChange,
}: {
  list: RefObject<HTMLElement | null>;
  passage: number | undefined;
  following: boolean;
  suspended: boolean;
  onFollowingChange: ((following: boolean) => void) | undefined;
}) {
  const [currentAbove, setCurrentAbove] = useState(false);
  const followed = useRef({ following, passage });

  useEffect(() => {
    const previous = followed.current;
    followed.current = { following, passage };
    if (!following || suspended || passage === undefined) return;
    if (previous.following && previous.passage === passage) return;
    list.current
      ?.querySelector('[aria-current="time"]')
      ?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  }, [list, following, suspended, passage]);

  useEffect(() => {
    if (!following || !onFollowingChange) return undefined;
    const stop = () => onFollowingChange(false);
    const stopOnWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) stop();
    };
    const stopOnKey = (event: KeyboardEvent) => {
      if (scrollsPage(event)) stop();
    };
    const stopOnScrollGesture = (event: PointerEvent) => {
      if (event.button === middleButton || event.target === document.documentElement) stop();
    };
    window.addEventListener("wheel", stopOnWheel, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stopOnKey);
    window.addEventListener("pointerdown", stopOnScrollGesture);
    return () => {
      window.removeEventListener("wheel", stopOnWheel);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stopOnKey);
      window.removeEventListener("pointerdown", stopOnScrollGesture);
    };
  }, [following, onFollowingChange]);

  useEffect(() => {
    if (following || passage === undefined) return undefined;
    const locate = () => {
      const bounds = list.current?.querySelector('[aria-current="time"]')?.getBoundingClientRect();
      setCurrentAbove(bounds !== undefined && bounds.bottom < pinnedHeight());
    };
    locate();
    window.addEventListener("scroll", locate, { passive: true });
    return () => window.removeEventListener("scroll", locate);
  }, [list, following, passage]);

  return { currentAbove };
}
