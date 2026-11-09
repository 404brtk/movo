import { Link, useMatch } from "@tanstack/react-router";
import { cn } from "../lib/utils.ts";
import { DownloadActivity, useActiveDownloads } from "./download-activity.tsx";
import { toggleVariants } from "./ui/toggle.tsx";
import { toggleGroupVariants } from "./ui/toggle-group.tsx";

const tabClassName = cn(toggleVariants({ variant: "segmented" }));

export function AppHeader() {
  const activeDownloads = useActiveDownloads().length;
  const onRecording = Boolean(useMatch({ from: "/media/$mediaId", shouldThrow: false }));
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:grid sm:h-14 sm:grid-cols-[1fr_auto_1fr] sm:px-6 sm:py-0">
      <Link
        to="/"
        aria-label="movo home"
        className="justify-self-start rounded-sm text-[17px] font-[650] tracking-[-0.04em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        movo
      </Link>
      <nav
        aria-label="Main"
        className={cn(
          toggleGroupVariants({ variant: "segmented" }),
          "max-sm:order-last max-sm:mx-auto",
        )}
      >
        <Link
          to="/"
          activeOptions={{ exact: true, includeSearch: false }}
          data-pressed={onRecording ? "" : undefined}
          className={tabClassName}
        >
          Library
        </Link>
        <Link to="/downloads" className={tabClassName}>
          {({ isActive }) => (
            <>
              Downloads
              {isActive && activeDownloads > 0 ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-grid h-4 min-w-4 place-items-center rounded-[5px] bg-linear-to-b from-primary-from to-primary-to px-1 text-[10.5px] font-semibold text-primary-foreground tabular-nums"
                  >
                    {activeDownloads}
                  </span>
                  <span className="sr-only">, {activeDownloads} in progress</span>
                </>
              ) : null}
            </>
          )}
        </Link>
        <Link to="/models" className={tabClassName}>
          Models
        </Link>
      </nav>
      <DownloadActivity />
    </header>
  );
}
