import { type ComponentType, useId, useState } from "react";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import {
  activeInstallationPhases,
  type ToolAvailability,
  type ToolInstallation,
} from "../../shared/contracts/media-tools.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button } from "./ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const sourceLabels = {
  managed: "private copy",
  system: "system copy",
  configured: "configured path",
} as const;

function describeReadyTools(tools: Record<string, ToolAvailability>) {
  const ready = Object.entries(tools).flatMap(([label, tool]) =>
    tool.state === "ready" ? [{ label, tool }] : [],
  );
  const versions = ready
    .map(({ label, tool }) => `${label} ${tool.version.split(/[\s-]/u)[0]}`)
    .join(" and ");
  const source = ready[0]?.tool.source;
  return source ? `${versions} · ${sourceLabels[source]}` : versions;
}

export function ToolRow<Status extends { installation: ToolInstallation }, Key extends QueryKey>({
  icon,
  name,
  title,
  description,
  options,
  tools: selectTools,
  setup: Setup,
}: {
  icon: IconSvgElement;
  name: string;
  title: string;
  description: string;
  options: UseQueryOptions<Status, Error, Status, Key>;
  tools: (status: Status) => Record<string, ToolAvailability>;
  setup: ComponentType<{ onClose: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery(options);
  const errorId = useId();
  const status = query.data;
  const tools = status ? selectTools(status) : {};
  const states = Object.values(tools);
  const ready = states.length > 0 && states.every((tool) => tool.state === "ready");
  const broken = states.some((tool) => tool.state === "broken");
  const installing = activeInstallationPhases.includes(status?.installation.phase ?? "");
  return (
    <li className="flex items-center gap-3.5 border-t py-3 first:border-t-0">
      <span className="w-[30px] shrink-0">
        <AccentIcon icon={icon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px]/[normal] font-medium">{title}</p>
        {query.isLoadingError ? (
          <p
            id={errorId}
            role="alert"
            className="mt-px text-xs/[normal] wrap-anywhere text-destructive"
          >
            {query.error.message}
          </p>
        ) : (
          <p className="mt-px truncate text-xs/[normal] text-muted-foreground">
            {ready ? describeReadyTools(tools) : description}
          </p>
        )}
      </div>
      {query.isLoadingError ? (
        <Button
          variant="outline"
          size="sm"
          aria-describedby={errorId}
          aria-busy={query.isFetching}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? <Spinner /> : null}
          Try again
        </Button>
      ) : status === undefined ? null : ready && !open ? (
        <StatusIndicator tone="success">Ready</StatusIndicator>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="outline" size="sm" />} aria-busy={installing}>
            {installing ? (
              <Spinner />
            ) : (
              <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" aria-hidden="true" />
            )}
            {installing ? "Downloading…" : broken ? `Repair ${name}` : `Download ${name}`}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] gap-0">
            <Setup onClose={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
      )}
    </li>
  );
}
