import { useLayoutEffect, useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useNavigate } from "@tanstack/react-router";
import { tagIdList, tagIdsIn, type TagRef } from "../../shared/contracts/tags.ts";
import { showsTagNames, tagCountLabel } from "../lib/tags.ts";
import { TagChip, TagOrbStack } from "./tag-chip.tsx";

export function RowTags({ tags }: { tags: readonly TagRef[] }) {
  if (tags.length === 0) return null;
  return showsTagNames(tags) ? <FittingTags tags={tags} /> : <TagCount tags={tags} />;
}

function FittingTags({ tags }: { tags: readonly TagRef[] }) {
  const space = useRef<HTMLSpanElement>(null);
  const names = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const slot = space.current;
    const chips = names.current;
    if (!slot || !chips) return undefined;
    const measure = () => setCompact(chips.offsetWidth > slot.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(chips);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={space} className="relative ml-1 min-w-0 flex-1">
      <span
        ref={names}
        aria-hidden={compact || undefined}
        className={compact ? "invisible absolute flex w-max gap-1" : "-my-1 flex w-max gap-1"}
      >
        {tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} size="row" />
        ))}
      </span>
      {compact ? <TagCount tags={tags} /> : null}
    </span>
  );
}

function TagCount({ tags }: { tags: readonly TagRef[] }) {
  const navigate = useNavigate({ from: "/" });
  const [open, setOpen] = useState(false);
  const label = tagCountLabel(tags.length);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        onFocus={(event) => {
          if (
            event.currentTarget.matches(":focus-visible") &&
            !event.relatedTarget?.closest("[data-tag-card]")
          )
            setOpen(true);
        }}
        openOnHover
        delay={400}
        closeDelay={150}
        aria-label={`${label}: ${tags.map((tag) => tag.name).join(", ")}`}
        className="relative z-10 -my-1 ml-1 inline-flex h-[18px] cursor-default items-center gap-1 rounded-[5px] px-1 align-middle outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <TagOrbStack tags={tags} ring="var(--background)" />
        {label}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-tag-card=""
            initialFocus={false}
            className="flex max-w-72 origin-(--transform-origin) flex-wrap gap-1.5 rounded-[14px] bg-popover p-2.5 text-popover-foreground shadow-popover outline-hidden duration-100 motion-reduce:animate-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                aria-label={`Show recordings tagged ${tag.name}`}
                className="flex max-w-full cursor-default rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => {
                  setOpen(false);
                  void navigate({
                    search: (previous) => ({
                      ...previous,
                      tags: tagIdList([...new Set([...tagIdsIn(previous.tags), tag.id])]),
                    }),
                  });
                }}
              >
                <TagChip
                  tag={tag}
                  size="card"
                  className="transition-[filter] hover:brightness-[0.97]"
                />
              </button>
            ))}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
