import { useEffect } from "react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { tagsOptions } from "../lib/api.ts";
import { TagChip } from "./tag-chip.tsx";
import { DraftTagsPanel, TagPopover } from "./tag-popovers.tsx";
import { Button } from "./ui/button.tsx";

export function TagsField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: readonly string[];
  onChange: (tagIds: readonly string[]) => void;
  disabled: boolean;
}) {
  const tags = useQuery(tagsOptions);
  const chosen = (tags.data ?? []).filter((tag) => value.includes(tag.id));
  const stale = tags.data !== undefined && chosen.length !== value.length;
  const remaining = chosen.map((tag) => tag.id).join(",");
  useEffect(() => {
    if (stale) onChange(remaining ? remaining.split(",") : []);
  }, [stale, remaining, onChange]);
  return (
    <fieldset
      id={id}
      aria-label="Tags"
      className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
    >
      {chosen.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          removeDisabled={disabled}
          onRemove={() => onChange(value.filter((each) => each !== tag.id))}
        />
      ))}
      <TagPopover
        label="Tags"
        trigger={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-6 gap-1 rounded-[7px] bg-muted px-2 hover:bg-input/60 aria-expanded:bg-input/60"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3" aria-hidden="true" />
            Add tags
          </Button>
        }
      >
        <DraftTagsPanel value={value} onChange={onChange} />
      </TagPopover>
    </fieldset>
  );
}
