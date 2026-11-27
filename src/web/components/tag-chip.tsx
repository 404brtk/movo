import type { ComponentProps, ReactNode } from "react";
import { Cancel01Icon, MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { TagRef } from "../../shared/contracts/tags.ts";
import type { TagState } from "../lib/tags.ts";
import { cn } from "../lib/utils.ts";

const chipSizes = {
  row: "h-[18px] rounded-[5px] px-[5px] text-[11.5px]",
  card: "h-[22px] rounded-[6px] px-[7px] text-xs",
  large: "h-6 rounded-[7px] px-2 text-[12.5px]",
} as const;

export function TagChip({
  tag,
  size = "large",
  onRemove,
  removeDisabled,
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  tag: Pick<TagRef, "name" | "color">;
  size?: keyof typeof chipSizes;
  onRemove?: () => void;
  removeDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      data-tag-color={tag.color}
      className={cn(
        "inline-flex max-w-full min-w-0 shrink-0 items-center gap-1 tag-chip font-medium whitespace-nowrap",
        chipSizes[size],
        onRemove && "pr-0.5",
        className,
      )}
      {...props}
    >
      <span className="truncate">{tag.name}</span>
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${tag.name}`}
          disabled={removeDisabled}
          onClick={onRemove}
          className="relative grid size-[18px] shrink-0 cursor-default place-items-center rounded-[5px] opacity-60 transition-opacity outline-none after:absolute after:-inset-1 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-3"
            aria-hidden="true"
          />
        </button>
      ) : null}
    </span>
  );
}

export function TagOrb({
  tag,
  state = "none",
  ring,
  className,
}: {
  tag: Pick<TagRef, "color">;
  state?: TagState;
  ring?: string;
  className?: string;
}) {
  const marked = state !== "none";
  return (
    <span
      aria-hidden="true"
      data-tag-color={tag.color}
      style={ring ? { "--tag-orb-ring": ring } : undefined}
      className={cn("grid size-4 shrink-0 place-items-center", className)}
    >
      <span
        className={cn(
          "grid place-items-center tag-orb text-white",
          marked ? "size-4" : "size-[9px]",
        )}
      >
        {marked ? (
          <HugeiconsIcon
            icon={state === "all" ? Tick02Icon : MinusSignIcon}
            strokeWidth={2.75}
            className="size-[11px]"
          />
        ) : null}
      </span>
    </span>
  );
}

export function TagOrbStack({
  tags,
  ring,
  className,
}: {
  tags: readonly Pick<TagRef, "id" | "color">[];
  ring?: string;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("flex items-center pl-[3px]", className)}>
      {tags.slice(0, 5).map((tag) => (
        <span
          key={tag.id}
          data-tag-color={tag.color}
          style={ring ? { "--tag-orb-ring": ring } : undefined}
          className="-ml-[3px] size-[9px] shrink-0 tag-orb"
        />
      ))}
    </span>
  );
}
