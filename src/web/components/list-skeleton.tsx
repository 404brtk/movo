import { Skeleton } from "./ui/skeleton.tsx";

const titleWidths = ["w-55", "w-75", "w-45"] as const;

export function ListSkeleton({ label = "Loading your library" }: { label?: string }) {
  return (
    <output aria-label={label} className="mt-11 grid gap-4.5 opacity-50">
      {titleWidths.map((width) => (
        <span key={width} className="flex items-center gap-3.5">
          <Skeleton className="size-10 rounded-[10px]" />
          <Skeleton className={`h-2.5 rounded-full ${width}`} />
        </span>
      ))}
    </output>
  );
}
