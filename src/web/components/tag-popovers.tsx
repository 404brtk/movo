import { type ReactElement, type ReactNode, type RefObject, useRef } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { maxTagsPerRecording, type Tag } from "../../shared/contracts/tags.ts";
import { bulkTagState, tagRef, useRecordingTags } from "../lib/tags.ts";
import { TagPanel } from "./tag-picker.tsx";

const popupClassName =
  "flex w-[248px] origin-(--transform-origin) flex-col rounded-[14px] bg-popover p-1 text-[13px] text-popover-foreground shadow-menu outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none";

export function TagPopover({
  open,
  onOpenChange,
  trigger,
  anchor,
  finalFocus,
  align = "start",
  label,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactElement;
  anchor?: RefObject<HTMLElement | null>;
  finalFocus?: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  label: string;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const restoreFocus = finalFocus
    ? () => {
        const active = document.activeElement;
        if (active !== document.body && !popup.current?.contains(active)) return false;
        return finalFocus.current;
      }
    : undefined;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <PopoverPrimitive.Trigger render={trigger} /> : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side="bottom"
          align={align}
          sideOffset={4}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            ref={popup}
            aria-label={label}
            finalFocus={restoreFocus}
            className={popupClassName}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function LimitNote({ subject }: { subject: string }) {
  return (
    <p className="px-2 pt-1 pb-1.5 text-xs/4 text-muted-foreground">
      {subject} has {maxTagsPerRecording} tags, the most it can have. Remove one to add another.
    </p>
  );
}

export function RecordingTagsPanel({ item }: { item: MediaItem }) {
  const change = useRecordingTags([item]);
  const chosen = new Set(item.tags.map((tag) => tag.id));
  const full = item.tags.length >= maxTagsPerRecording;
  const add = (tag: Tag) => change.mutate({ add: [tagRef(tag)], remove: [] });
  return (
    <TagPanel
      placeholder={full ? "Find a tag" : "Find or create a tag"}
      stateOf={(tag) => (chosen.has(tag.id) ? "all" : "none")}
      onToggle={(tag, state) =>
        state === "all" ? change.mutate({ add: [], remove: [tagRef(tag)] }) : add(tag)
      }
      onCreate={add}
      full={full}
      footer={full ? <LimitNote subject="This recording" /> : null}
      manage
    />
  );
}

export function BulkTagsPanel({ items }: { items: readonly MediaItem[] }) {
  const change = useRecordingTags(items);
  const add = (tag: Tag) => change.mutate({ add: [tagRef(tag)], remove: [] });
  return (
    <TagPanel
      placeholder="Find or create a tag"
      label={`On ${items.length} selected ${items.length === 1 ? "recording" : "recordings"}`}
      stateOf={(tag) => bulkTagState(items, tag.id).state}
      detailOf={(tag) => {
        const { count } = bulkTagState(items, tag.id);
        return count > 0 ? `${count} of ${items.length}` : null;
      }}
      onToggle={(tag, state) =>
        state === "all" ? change.mutate({ add: [], remove: [tagRef(tag)] }) : add(tag)
      }
      onCreate={add}
      manage
    />
  );
}

export function DraftTagsPanel({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (tagIds: readonly string[]) => void;
}) {
  const chosen = new Set(value);
  const full = value.length >= maxTagsPerRecording;
  const add = (tag: Tag) => onChange([...value, tag.id]);
  return (
    <TagPanel
      placeholder={full ? "Find a tag" : "Find or create a tag"}
      stateOf={(tag) => (chosen.has(tag.id) ? "all" : "none")}
      onToggle={(tag, state) =>
        state === "all" ? onChange(value.filter((id) => id !== tag.id)) : add(tag)
      }
      onCreate={add}
      full={full}
      footer={full ? <LimitNote subject="Each recording" /> : null}
      manage
    />
  );
}
