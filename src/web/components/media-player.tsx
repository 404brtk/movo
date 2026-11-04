import { useState } from "react";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { mediaFileUrl } from "../lib/api.ts";

export function MediaPlayer({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-3">
      {item.kind === "video" ? (
        <div className="overflow-hidden rounded-xl bg-black">
          <video
            className="mx-auto max-h-[65svh] w-full"
            src={mediaFileUrl(item.id)}
            controls
            preload="metadata"
            aria-label={item.title}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/40 px-4 py-8 sm:px-8">
          <audio
            className="w-full"
            src={mediaFileUrl(item.id)}
            controls
            preload="metadata"
            aria-label={item.title}
            onError={() => setFailed(true)}
          />
        </div>
      )}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          This file could not be played. Its codec may not be supported by your browser, or the
          saved copy may be unavailable. You can try saving a copy and opening it in another player.
        </p>
      ) : null}
    </div>
  );
}
