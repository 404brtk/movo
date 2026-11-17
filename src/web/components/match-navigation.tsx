import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StepDirection } from "../lib/match-stepper.ts";
import { Button } from "./ui/button.tsx";

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
