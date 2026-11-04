import { MusicNote01Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MediaItem } from "../../shared/contracts/media.ts";

export function MediaIcon({ kind }: { kind: MediaItem["kind"] }) {
  return (
    <HugeiconsIcon
      icon={kind === "video" ? Video01Icon : MusicNote01Icon}
      size={24}
      aria-hidden="true"
    />
  );
}
