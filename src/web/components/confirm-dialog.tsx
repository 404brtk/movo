import { type RefObject, useRef } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { AccentIcon } from "./accent-icon.tsx";
import { Spinner } from "./spinner.tsx";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";

export function ConfirmDialog({
  open,
  onOpenChange,
  returnFocus,
  icon,
  title,
  description,
  keep,
  confirm,
  pending,
  busy,
  error,
  severity = "soft",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null> | false;
  icon: IconSvgElement;
  title: string;
  description: string;
  keep: string;
  confirm: string;
  pending: string;
  busy: boolean;
  error: string | null;
  severity?: "soft" | "permanent";
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent finalFocus={returnFocus}>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <AccentIcon icon={icon} size={26} tone="danger" />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="mt-3 text-[13px]/5 wrap-anywhere text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{keep}</AlertDialogCancel>
          <Button
            variant={severity === "permanent" ? "danger" : "destructive"}
            aria-busy={busy}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Spinner /> : null}
            {busy ? pending : confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CleanupNotice({
  cleanupError,
  title,
  acknowledge,
  onAcknowledge,
}: {
  cleanupError: string | undefined;
  title: string;
  acknowledge: string;
  onAcknowledge: () => void;
}) {
  const acknowledgeButton = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={Boolean(cleanupError)}
      onOpenChange={(next) => {
        if (!next) onAcknowledge();
      }}
    >
      <AlertDialogContent initialFocus={acknowledgeButton}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription aria-live="polite">{cleanupError}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button ref={acknowledgeButton} onClick={onAcknowledge}>
            {acknowledge}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
