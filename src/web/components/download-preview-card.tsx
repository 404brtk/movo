import type { ReactNode } from "react";
import type { DownloadPreview } from "../../shared/contracts/downloads.ts";
import { formatDuration, formatSourceHost } from "../lib/format.ts";

function PreviewCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-border)]">
      {children}
    </div>
  );
}

export function DownloadPreviewCard({ preview }: { preview: DownloadPreview }) {
  const duration =
    preview.durationSeconds === null ? null : formatDuration(preview.durationSeconds);
  return (
    <PreviewCard>
      <span
        aria-hidden="true"
        className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-[radial-gradient(120%_90%_at_20%_10%,oklch(0.78_0.08_230),oklch(0.42_0.09_250))]"
      >
        {duration ? (
          <span className="absolute right-[5px] bottom-[5px] rounded-[4px] bg-black/60 px-[5px] py-px text-[10.5px] font-medium text-white tabular-nums">
            {duration}
          </span>
        ) : null}
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px]/[19px] font-medium wrap-anywhere">{preview.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {[formatSourceHost(preview.url), duration ?? "Duration unknown"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </PreviewCard>
  );
}

export function DownloadBatchCard({ count }: { count: number }) {
  return (
    <PreviewCard>
      <div className="min-w-0">
        <p className="text-[13.5px]/[19px] font-medium">{count} links</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Movo checks each link when its download starts.
        </p>
      </div>
    </PreviewCard>
  );
}
