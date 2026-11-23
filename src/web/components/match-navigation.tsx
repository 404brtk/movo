import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { StepDirection } from "../lib/match-stepper.ts";
import { nextMatchLabel, previousMatchLabel } from "../lib/transcript-shortcuts.ts";
import { Button } from "./ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

function StepButton({
  label,
  shortcut,
  icon,
  steppable,
  onStep,
}: {
  label: string;
  shortcut: string;
  icon: IconSvgElement;
  steppable: boolean;
  onStep: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={label}
        disabled={!steppable}
        onClick={onStep}
      >
        <HugeiconsIcon icon={icon} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <span className="ml-1.5 text-background/60 tabular-nums">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
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
    <TooltipProvider>
      <div className="flex">
        <StepButton
          label="Previous match"
          shortcut={previousMatchLabel}
          icon={ArrowUp01Icon}
          steppable={steppable}
          onStep={() => onStep(-1)}
        />
        <StepButton
          label="Next match"
          shortcut={nextMatchLabel}
          icon={ArrowDown01Icon}
          steppable={steppable}
          onStep={() => onStep(1)}
        />
      </div>
    </TooltipProvider>
  );
}
