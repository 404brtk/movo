import { type KeyboardEvent, useState } from "react";

export type StepDirection = 1 | -1;

export function useMatchStepper(count: number) {
  const [current, setCurrent] = useState(0);
  const index = count === 0 ? 0 : Math.min(current, count - 1);
  return {
    index,
    reset: () => setCurrent(0),
    step: (direction: StepDirection) => {
      const next = (count + index + direction) % Math.max(count, 1);
      setCurrent(next);
      return next;
    },
  };
}

export const focusOnMount = (input: HTMLInputElement | null) => input?.focus();

export const stepOnEnter =
  (step: (direction: StepDirection) => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  };

export function matchCountLabel({
  searching,
  previewCurrent,
  index,
  count,
}: {
  searching: boolean;
  previewCurrent: boolean;
  index: number;
  count: number;
}) {
  if (!searching || !previewCurrent) return "";
  return count > 0 ? `${index + 1} of ${count}` : "No matches";
}
