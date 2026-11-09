import { cn } from "cn";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex items-center rounded-[4px] bg-background px-[5px] py-0.5 font-sans text-[11px]/none font-medium text-foreground shadow-[inset_0_0_0_1px_var(--color-input),inset_0_-1px_0_var(--color-input)] select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
