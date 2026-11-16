import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export function MenuIcon({ icon }: { icon: IconSvgElement }) {
  return <HugeiconsIcon icon={icon} aria-hidden="true" className="text-muted-foreground" />;
}
