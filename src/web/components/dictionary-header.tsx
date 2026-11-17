import type { ReactNode } from "react";
import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { DialogClose, DialogTitle } from "./ui/dialog.tsx";

export function DictionaryHeader({
  title,
  onBack,
  actions,
}: {
  title: string;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="mt-4 mr-[11px] ml-2 flex h-7 shrink-0 items-center gap-2">
      {onBack ? (
        <Button variant="ghost" size="icon-sm" aria-label="Back to Dictionary" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden="true" />
        </Button>
      ) : null}
      <DialogTitle className={cn("min-w-0 flex-1 truncate", !onBack && "pl-3")}>
        {title}
      </DialogTitle>
      <div className="flex items-center gap-1">
        {actions}
        <DialogClose render={<Button variant="ghost" size="icon-sm" />} aria-label="Close">
          <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
        </DialogClose>
      </div>
    </div>
  );
}
