import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[28px]/[34px] font-semibold tracking-[-0.025em] text-balance">
          {title}
        </h1>
        <p className="mt-1.5 max-w-[520px] text-[13px]/5 text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}
