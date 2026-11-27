import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

const sides = {
  right:
    "inset-y-3 right-3 w-[380px] max-w-[calc(100%-1.5rem)] rounded-[18px] data-open:slide-in-from-right-4 data-closed:slide-out-to-right-4",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[18px] pb-[max(1.25rem,env(safe-area-inset-bottom))] data-open:slide-in-from-bottom-4 data-closed:slide-out-to-bottom-4",
} as const;

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: SheetPrimitive.Popup.Props & { side?: keyof typeof sides }) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      {side === "bottom" ? (
        <SheetPrimitive.Backdrop
          data-slot="sheet-overlay"
          className="fixed inset-0 z-50 bg-scrim duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
      ) : null}
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col overflow-y-auto overscroll-contain bg-background/92 pb-5 text-[13px] text-foreground shadow-sheet backdrop-blur-xl backdrop-saturate-[1.8] duration-200 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          sides[side],
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({
  className,
  children,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<"div"> & { closeLabel?: string }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex items-center justify-between pt-4 pr-3 pb-2 pl-5", className)}
      {...props}
    >
      {children}
      <SheetPrimitive.Close render={<Button variant="ghost" size="icon-sm" />}>
        <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
        <span className="sr-only">{closeLabel}</span>
      </SheetPrimitive.Close>
    </div>
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[15px] font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("px-5 text-[12.5px]/[19px] text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger };
