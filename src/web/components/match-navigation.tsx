import type { ReactNode } from "react";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StepDirection } from "../lib/match-stepper.ts";
import { pinHeight } from "../lib/transcript-follow.ts";
import { Button } from "./ui/button.tsx";

const pinBelowPlayer = pinHeight("--pinned-find");

export function PinnedBelowPlayer({ children }: { children: ReactNode }) {
  return (
    <div
      ref={pinBelowPlayer}
      className="sticky top-[var(--pinned-player,0px)] z-30 bg-background pt-3 pb-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent"
    >
      {children}
    </div>
  );
}

export function MatchStepper({
  steppable,
  onStep,
}: {
  steppable: boolean;
  onStep: (direction: StepDirection) => void;
}) {
  return (
    <div className="flex">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous match"
        disabled={!steppable}
        onClick={() => onStep(-1)}
      >
        <HugeiconsIcon icon={ArrowUp01Icon} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next match"
        disabled={!steppable}
        onClick={() => onStep(1)}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden="true" />
      </Button>
    </div>
  );
}
