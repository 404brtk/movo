import { useState } from "react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { currentChapterIndex } from "../../shared/chapters.ts";
import { ChapterList, type ChapterContext } from "./chapter-list.tsx";
import type { MediaPlayback } from "./playback-controls.tsx";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet.tsx";

export function ChapterSheetContent({
  context,
  onPicked,
}: {
  context: ChapterContext;
  onPicked: () => void;
}) {
  return (
    <SheetContent side="bottom" aria-label="Chapters" className="pt-2">
      <span aria-hidden="true" className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-border" />
      <ChapterList context={context} variant="sheet" onPicked={onPicked} />
    </SheetContent>
  );
}

export function CurrentChapter({
  playback,
  context,
}: {
  playback: MediaPlayback;
  context: ChapterContext;
}) {
  const [open, setOpen] = useState(false);
  const { chapters } = playback;
  const current = chapters[currentChapterIndex(chapters, playback.state.currentTime * 1000)];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={current ? `Chapter: ${current.chapter.title}. Show chapters` : "Show chapters"}
        className="-ml-1 flex min-h-6 max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm pl-1 text-[12.5px]/[normal] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 truncate">{current?.chapter.title ?? "Chapters"}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </SheetTrigger>
      <ChapterSheetContent context={context} onPicked={() => setOpen(false)} />
    </Sheet>
  );
}
