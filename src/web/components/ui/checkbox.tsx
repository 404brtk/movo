import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "cn";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-background text-primary-foreground transition-[background-color,border-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-indeterminate:border-primary-edge data-indeterminate:bg-linear-to-b data-indeterminate:from-primary-from data-indeterminate:to-primary-to dark:bg-input/30 data-checked:border-primary-edge data-checked:bg-linear-to-b data-checked:from-primary-from data-checked:to-primary-to",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3"
        render={(indicatorProps, state) => (
          <span {...indicatorProps}>
            <HugeiconsIcon
              icon={state.indeterminate ? MinusSignIcon : Tick02Icon}
              strokeWidth={2.5}
            />
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
