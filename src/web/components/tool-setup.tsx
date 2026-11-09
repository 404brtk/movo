import { useState } from "react";
import { Download04Icon, Wrench01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type QueryKey,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  activeInstallationPhases,
  type ToolAvailability,
  type ToolDownload,
  type ToolInstallation,
} from "../../shared/contracts/media-tools.ts";
import { formatBytes } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button } from "./ui/button.tsx";
import { Progress, ProgressLabel, ProgressValue } from "./ui/progress.tsx";

function ToolState({ tool }: { tool: ToolAvailability }) {
  if (tool.state === "ready")
    return <StatusIndicator tone="success">Ready · {tool.version}</StatusIndicator>;
  if (tool.state === "broken")
    return <StatusIndicator tone="warning">Needs repair</StatusIndicator>;
  return <StatusIndicator tone="idle">Not found</StatusIndicator>;
}

export function ToolSetup<
  Status extends { download: ToolDownload | null; installation: ToolInstallation },
  Key extends QueryKey,
>({
  id,
  title,
  readyTitle,
  name,
  description,
  options,
  install: installTools,
  tools: selectTools,
  provider,
  manualSetup,
  readyMessage,
  onClose,
  className,
}: {
  id: string;
  title: string;
  readyTitle: string;
  name: string;
  description: string;
  options: UseQueryOptions<Status, Error, Status, Key>;
  install: () => Promise<Status>;
  tools: (status: Status) => Record<string, ToolAvailability>;
  provider: string;
  manualSetup: string;
  readyMessage: string;
  onClose: () => void;
  className?: string | undefined;
}) {
  const [showManualSetup, setShowManualSetup] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery(options);
  const install = useMutation({
    mutationFn: installTools,
    onSuccess: (status) => queryClient.setQueryData<Status>(options.queryKey, status),
  });
  const status = query.data;
  const tools = status ? Object.entries(selectTools(status)) : [];
  const busy =
    install.isPending || activeInstallationPhases.includes(status?.installation.phase ?? "");
  const ready = tools.length > 0 && tools.every(([, tool]) => tool.state === "ready");
  const brokenMessages = tools.flatMap(([, tool]) =>
    tool.state === "broken" ? [tool.message] : [],
  );
  const configuredError = tools.some(
    ([, tool]) => tool.state === "broken" && tool.source === "configured",
  );
  const failure = install.error?.message ?? query.error?.message ?? status?.installation.error;
  const download = ready ? null : status?.download;
  const phase = status?.installation.phase;
  const announcement =
    phase === "downloading"
      ? `Downloading ${name}…`
      : phase === "verifying"
        ? "Verifying download…"
        : phase === "extracting"
          ? `Installing ${name}…`
          : phase === "validating"
            ? `Checking ${name}…`
            : ready
              ? readyMessage
              : "";

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("w-full text-left", className)}
    >
      <h2
        id={`${id}-heading`}
        className="flex items-center gap-2 text-[15px]/[22px] font-semibold tracking-[-0.01em]"
      >
        <AccentIcon icon={Wrench01Icon} size={18} />
        {ready ? readyTitle : title}
      </h2>
      <p className="mt-1.5 text-[13px]/5 text-muted-foreground">
        {ready ? readyMessage : description}
      </p>
      {status ? (
        <ul className="mt-3.5 rounded-[10px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-border)]">
          {tools.map(([label, tool]) => (
            <li
              key={label}
              className="flex h-10 items-center justify-between gap-3 border-t px-3 text-[13px] first:border-t-0"
            >
              <span className="font-medium">{label}</span>
              <ToolState tool={tool} />
            </li>
          ))}
        </ul>
      ) : null}
      {brokenMessages.map((message) => (
        <p key={message} className="mt-2.5 text-xs/[17px] wrap-anywhere text-destructive">
          {message}
        </p>
      ))}
      {busy && status?.download ? (
        <Progress
          className="mt-3.5"
          value={status.installation.downloadedBytes}
          max={status.download.bytes}
        >
          <ProgressLabel>Downloading {name}</ProgressLabel>
          <ProgressValue>
            {() =>
              `${formatBytes(status.installation.downloadedBytes)} of ${formatBytes(status.download?.bytes ?? 0)}`
            }
          </ProgressValue>
        </Progress>
      ) : null}
      {download ? (
        <p className="mt-2.5 text-xs/[17px] text-muted-foreground">
          From{" "}
          <a
            className="text-foreground underline decoration-border-strong underline-offset-3"
            href={download.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {download.provider}
          </a>
          , {provider} · {formatBytes(download.bytes)}. Stored only inside Movo.{" "}
          <button
            type="button"
            aria-expanded={showManualSetup}
            onClick={() => setShowManualSetup((shown) => !shown)}
            className="whitespace-nowrap text-foreground underline decoration-border-strong underline-offset-3"
          >
            Set up manually
          </button>
        </p>
      ) : null}
      {status && !ready && (!status.download || showManualSetup) ? (
        <p className="mt-2.5 text-xs/[17px] text-muted-foreground">
          {status.download ? "" : "Automatic downloads are unavailable on this platform. "}
          {manualSetup}
        </p>
      ) : null}
      {busy ? (
        <p className="mt-2.5 text-xs/[17px] text-muted-foreground">
          You can close this panel; the download continues.
        </p>
      ) : null}
      <output className="sr-only">{announcement}</output>
      {failure ? (
        <p role="alert" className="mt-2.5 text-xs/[17px] wrap-anywhere text-destructive">
          {failure}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {!busy && !ready && (!status?.download || configuredError) ? (
          <Button
            variant="ghost"
            onClick={() => {
              install.reset();
              void query.refetch();
            }}
          >
            Check again
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {ready ? "Close" : "Not now"}
        </Button>
        {status?.download && !ready && !configuredError ? (
          <Button aria-busy={busy} disabled={busy} onClick={() => install.mutate()}>
            {busy ? (
              <Spinner />
            ) : (
              <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" aria-hidden="true" />
            )}
            {busy ? "Downloading…" : failure ? "Retry download" : `Download ${name}`}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
