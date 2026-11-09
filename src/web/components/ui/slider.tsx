import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

const tones = {
  default: {
    track: "bg-border",
    range: "bg-linear-to-r from-primary-from to-primary-to",
  },
  overlay: { track: "bg-white/35", range: "bg-white" },
} as const;

function Slider({
  className,
  tone = "default",
  getAriaValueText,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props<number> &
  Pick<SliderPrimitive.Thumb.Props, "getAriaValueText"> & {
    tone?: keyof typeof tones;
    "aria-label"?: string;
  }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      thumbAlignment="edge"
      className={cn("group/slider w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-4 w-full touch-none items-center select-none data-disabled:opacity-50">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn("relative h-1 w-full rounded-[2px] select-none", tones[tone].track)}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn("h-full rounded-[2px] select-none", tones[tone].range)}
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={ariaLabel}
            getAriaValueText={getAriaValueText}
            className="block size-3 rounded-full bg-white shadow-raised transition-opacity duration-150 ease-snappy outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/slider:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
