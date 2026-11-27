import { useState, type PointerEvent } from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

const tones = {
  default: {
    track: "bg-border",
    range: "bg-linear-to-r from-primary-from to-primary-to",
    fill: "bg-primary-strong",
    highlight: "bg-primary/30",
    gap: 3,
  },
  overlay: {
    track: "bg-white/35",
    range: "bg-white",
    fill: "bg-white",
    highlight: "bg-white/70",
    gap: 2,
  },
} as const;

type Span = { from: number; to: number };

function Slider({
  className,
  tone = "default",
  highlights = [],
  segments = [],
  getAriaValueText,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props<number> &
  Pick<SliderPrimitive.Thumb.Props, "getAriaValueText"> & {
    tone?: keyof typeof tones;
    highlights?: readonly Span[] | undefined;
    segments?: readonly (Span & { label: string; time: string })[] | undefined;
    "aria-label"?: string;
  }) {
  const [hovered, setHovered] = useState<{ index: number; x: number } | null>(null);
  const min = props.min ?? 0;
  const span = Math.max((props.max ?? 100) - min, Number.EPSILON);
  const percent = (value: number) => (Math.min(Math.max(value - min, 0), span) / span) * 100;
  const value = typeof props.value === "number" ? props.value : min;
  const style = tones[tone];
  const segmented = segments.length > 1;
  const hover = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const at = min + (x / Math.max(bounds.width, 1)) * span;
    const index = segments.findLastIndex((segment) => segment.from <= at);
    setHovered(index < 0 ? null : { index, x });
  };
  const label = hovered ? segments[hovered.index] : undefined;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      thumbAlignment="edge"
      className={cn("group/slider w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control
        className="relative flex h-4 w-full touch-none items-center select-none data-disabled:opacity-50"
        onPointerMove={segmented ? hover : undefined}
        onPointerLeave={segmented ? () => setHovered(null) : undefined}
      >
        {label && hovered ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[calc(100%+6px)] z-10 flex max-w-60 -translate-x-1/2 items-baseline gap-2 rounded-md bg-foreground px-2 py-1 text-xs/4 font-medium whitespace-nowrap text-background shadow-raised"
            style={{ left: `clamp(4rem, ${hovered.x}px, calc(100% - 4rem))` }}
          >
            <span className="min-w-0 truncate">{label.label}</span>
            <span className="font-normal text-background/65 tabular-nums">{label.time}</span>
          </span>
        ) : null}
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn("relative h-1 w-full rounded-[2px] select-none", !segmented && style.track)}
        >
          {segmented
            ? segments.map((segment, index) => {
                const width = percent(segment.to) - percent(segment.from);
                const filled =
                  ((value - segment.from) / Math.max(segment.to - segment.from, Number.EPSILON)) *
                  100;
                return (
                  <span
                    key={segment.from}
                    data-slot="slider-segment"
                    className={cn(
                      "absolute top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-[2px] transition-[height] duration-150 ease-snappy motion-reduce:transition-none",
                      style.track,
                      hovered?.index === index && "h-1.5",
                    )}
                    style={{
                      left: `${percent(segment.from)}%`,
                      width: `calc(${width}% - ${index === segments.length - 1 ? 0 : style.gap}px)`,
                    }}
                  >
                    {highlights.map(({ from, to }) =>
                      to <= segment.from || from >= segment.to ? null : (
                        <span
                          key={from}
                          data-slot="slider-highlight"
                          className={cn("absolute inset-y-0", style.highlight)}
                          style={{
                            left: `${((Math.max(from, segment.from) - segment.from) / (segment.to - segment.from)) * 100}%`,
                            width: `${((Math.min(to, segment.to) - Math.max(from, segment.from)) / (segment.to - segment.from)) * 100}%`,
                          }}
                        />
                      ),
                    )}
                    <span
                      className={cn("absolute inset-y-0 left-0", style.fill)}
                      style={{ width: `${Math.min(Math.max(filled, 0), 100)}%` }}
                    />
                  </span>
                );
              })
            : highlights.map(({ from, to }) => (
                <span
                  key={from}
                  data-slot="slider-highlight"
                  className={cn("absolute inset-y-0 rounded-[2px]", style.highlight)}
                  style={{ left: `${percent(from)}%`, width: `${percent(to) - percent(from)}%` }}
                />
              ))}
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "h-full rounded-[2px] select-none",
              segmented ? "invisible" : style.range,
            )}
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
