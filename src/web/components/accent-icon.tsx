import { useId } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

const tones = {
  primary: ["var(--color-primary-from)", "var(--color-primary-to)"],
  danger: ["var(--color-destructive-from)", "var(--color-destructive)"],
} as const;

export function AccentIcon({
  icon,
  size,
  tone = "primary",
}: {
  icon: IconSvgElement;
  size: number;
  tone?: keyof typeof tones;
}) {
  const gradientId = useId();
  const [from, to] = tones[tone];
  return (
    <>
      <svg aria-hidden="true" className="absolute size-0">
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: from }} />
          <stop offset="1" style={{ stopColor: to }} />
        </linearGradient>
      </svg>
      <HugeiconsIcon
        icon={icon}
        size={size}
        aria-hidden="true"
        className="block *:stroke-(--accent-stroke)"
        style={{ "--accent-stroke": `url("#${gradientId}")` }}
      />
    </>
  );
}
