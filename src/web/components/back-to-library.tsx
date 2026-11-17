import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "./ui/button.tsx";

export function BackToLibrary() {
  return (
    <Link
      to="/"
      aria-label="Back to library"
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      <HugeiconsIcon icon={ArrowLeft02Icon} data-icon="inline-start" aria-hidden="true" />
      Library
    </Link>
  );
}
