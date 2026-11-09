import type { ReactNode } from "react";
import type { StatusTone } from "../lib/status-tone.ts";
import { cn } from "../lib/utils.ts";

const tones = {
  success: { dot: "bg-success", text: "" },
  active: { dot: "bg-primary", text: "text-primary-strong" },
  idle: { dot: "bg-muted-foreground/30", text: "text-muted-foreground" },
  warning: { dot: "bg-warning", text: "text-warning" },
  danger: { dot: "bg-destructive", text: "text-destructive" },
} as const satisfies Record<StatusTone, { dot: string; text: string }>;

export function StatusIndicator({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium", tones[tone].text)}
    >
      <span
        aria-hidden="true"
        className={cn("size-[7px] shrink-0 rounded-full", tones[tone].dot)}
      />
      {children}
    </span>
  );
}
