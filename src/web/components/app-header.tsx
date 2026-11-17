import { Link, useMatchRoute } from "@tanstack/react-router";
import { cn } from "../lib/utils.ts";
import { DownloadActivity } from "./download-activity.tsx";
import { toggleVariants } from "./ui/toggle.tsx";
import { toggleGroupVariants } from "./ui/toggle-group.tsx";

const tabClassName = cn(toggleVariants({ variant: "segmented" }), "max-sm:px-2");

export function AppHeader() {
  const matchRoute = useMatchRoute();
  const onRecording = Boolean(matchRoute({ to: "/media/$mediaId" }));
  const insideLibrary = onRecording || Boolean(matchRoute({ to: "/downloads" }));
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-background px-4 py-3 sm:grid sm:h-14 sm:grid-cols-[1fr_auto_1fr] sm:px-6 sm:py-0",
        onRecording && "sm:sticky sm:top-0 sm:z-30",
      )}
    >
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
          data-pressed={insideLibrary ? "" : undefined}
          className={tabClassName}
        >
          Library
        </Link>
        <Link to="/ask" search={{}} className={tabClassName}>
          Ask
        </Link>
        <Link to="/settings" className={tabClassName}>
          Settings
        </Link>
      </nav>
      <DownloadActivity />
    </header>
  );
}
