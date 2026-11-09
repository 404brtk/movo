import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "./ui/button.tsx";

export function NotFound({
  description = "The page may have moved, or the link is out of date.",
}: {
  description?: string;
}) {
  return (
    <main className="flex flex-col items-center px-5 pt-[200px] pb-16 text-center max-sm:pt-24">
      <p className="text-[13px] font-semibold text-primary tabular-nums">404</p>
      <h1 className="mt-2 text-[28px]/[34px] font-semibold tracking-[-0.025em] text-balance">
        This page doesn’t exist
      </h1>
      <p className="mt-2 max-w-[360px] text-sm/[22px] text-balance text-muted-foreground">
        {description}
      </p>
      <Link to="/" className={buttonVariants({ className: "mt-[22px]" })}>
        <HugeiconsIcon icon={ArrowLeft02Icon} data-icon="inline-start" aria-hidden="true" />
        Back to library
      </Link>
    </main>
  );
}
