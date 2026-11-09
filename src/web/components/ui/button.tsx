import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const outline =
  "border-input bg-linear-to-b from-background to-subtle shadow-button hover:border-border-strong hover:from-subtle hover:to-muted active:from-muted active:to-subtle active:shadow-button-pressed aria-expanded:from-muted aria-expanded:to-subtle aria-expanded:shadow-button-pressed dark:bg-input/30";

const buttonStyles = cva(
  "group/button inline-flex shrink-0 cursor-default items-center justify-center rounded-md border border-transparent bg-origin-border text-[13px] leading-none font-medium tracking-[-0.006em] whitespace-nowrap outline-none select-none transition-press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45 aria-busy:disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 motion-safe:active:scale-[0.97] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary-edge bg-linear-to-b from-primary-from to-primary-to font-[550] text-primary-foreground shadow-button-primary hover:from-primary-from-hover hover:to-primary-to-hover active:from-primary-from-pressed active:to-primary-to-pressed active:shadow-button-primary-pressed",
        outline,
        toggle: `${outline} aria-expanded:border-primary/25 aria-expanded:from-tint aria-expanded:to-highlight aria-expanded:text-primary-strong aria-expanded:shadow-button-tinted`,
        secondary:
          "border-primary/18 bg-linear-to-b from-tint to-highlight text-primary-deep shadow-button-tinted hover:border-primary/28 hover:from-highlight active:shadow-button-pressed",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-input/70 aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "border-destructive/16 bg-linear-to-b from-destructive-tint to-destructive-subtle text-destructive shadow-button-tinted hover:border-destructive/28 hover:from-destructive-subtle hover:to-destructive-muted focus-visible:outline-destructive active:shadow-button-pressed",
        danger:
          "border-destructive-edge bg-linear-to-b from-destructive-from to-destructive font-[550] text-primary-foreground shadow-button-danger hover:from-destructive-from-hover hover:to-destructive-to-hover focus-visible:outline-destructive active:from-destructive-from-pressed active:to-destructive-to-pressed active:shadow-button-danger-pressed",
        link: "cursor-pointer text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-3 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-7 gap-1.5 rounded-[7px] px-2.5 text-[12.5px]",
        lg: "h-9 gap-1.5 rounded-[9px] px-3.5 text-[13.5px] has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-7 rounded-[7px]",
        "icon-lg": "size-9 rounded-[9px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonVariants = (options: Parameters<typeof buttonStyles>[0]) => cn(buttonStyles(options));

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonStyles>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
