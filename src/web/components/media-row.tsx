import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./media-thumbnail.tsx";

export function MediaRow({
  item,
  title,
  details,
  status,
  className,
}: {
  item: LibraryItem;
  title: ReactNode;
  details: ReactNode;
  status: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3.5 rounded-[10px] px-2.5 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50",
        className,
      )}
    >
      <MediaThumbnail item={item} />
      <div className="min-w-0 flex-1">
        <Link
          to="/media/$mediaId"
          params={{ mediaId: item.id }}
          aria-label={`Open ${item.title}`}
          className="block truncate text-sm/5 font-medium outline-none after:absolute after:inset-0 after:rounded-[10px]"
        >
          {title}
        </Link>
        <div className="truncate text-xs/[normal] text-muted-foreground tabular-nums">
          {details}
        </div>
      </div>
      <div className="pointer-events-none relative flex shrink-0 [&_a,&_button]:pointer-events-auto">
        {status}
      </div>
    </div>
  );
}
