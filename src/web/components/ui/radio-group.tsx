import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "cn";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "peer relative flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border-strong bg-background transition-[background-color,border-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 dark:bg-input/30 data-checked:border-primary-edge data-checked:bg-linear-to-b data-checked:from-primary-from data-checked:to-primary-to data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="size-1.5 rounded-full bg-primary-foreground shadow-[0_1px_1px_oklch(0.2_0.01_262/0.2)] transition-transform duration-150 ease-snappy data-starting-style:scale-0"
      />
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
