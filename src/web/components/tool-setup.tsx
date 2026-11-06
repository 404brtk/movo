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
import { Button } from "./ui/button.tsx";

export function ToolSetup<
  Status extends { download: ToolDownload | null; installation: ToolInstallation },
  Key extends QueryKey,
>({
  id,
  title,
  name,
  description,
  options,
  install: installTools,
  tools: selectTools,
  provider,
  manualSetup,
  readyMessage,
  onClose,
}: {
  id: string;
  title: string;
  name: string;
  description: string;
  options: UseQueryOptions<Status, Error, Status, Key>;
  install: () => Promise<Status>;
  tools: (status: Status) => Record<string, ToolAvailability>;
  provider: string;
  manualSetup: string;
  readyMessage: string;
  onClose: () => void;
}) {
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
  const configuredError = tools.some(
    ([, tool]) => tool.state === "broken" && tool.source === "configured",
  );
  const failure = install.error?.message ?? query.error?.message ?? status?.installation.error;
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
      className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-5 text-left text-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={`${id}-heading`} className="font-medium">
          {title}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="leading-6 text-muted-foreground">{description}</p>
      {status ? (
        <ul className="space-y-2">
          {tools.map(([label, tool]) => (
            <li key={label}>
              <span className="font-medium">{label}: </span>
              {tool.state === "ready"
                ? `Ready · ${tool.version} · ${tool.source}`
                : tool.state === "broken"
                  ? tool.message
                  : "Not found"}
            </li>
          ))}
        </ul>
      ) : null}
      {status?.download && !ready ? (
        <p className="text-muted-foreground">
          Download: {formatBytes(status.download.bytes)} · version {status.download.version}. Built
          by{" "}
          <a
            className="underline underline-offset-4"
            href={status.download.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {status.download.provider}
          </a>
          , {provider}. Saved in Movo’s data folder.
        </p>
      ) : null}
      {status && !status.download && !ready ? (
        <p>Automatic downloads are unavailable on this platform. {manualSetup}</p>
      ) : null}
      <output className="block text-muted-foreground">{announcement}</output>
      {busy && status?.download ? (
        <div className="space-y-2">
          <progress
            aria-label={`${title} download`}
            className="h-2 w-full accent-primary"
            value={status.installation.downloadedBytes}
            max={status.download.bytes}
          />
          <p className="text-xs text-muted-foreground">
            {formatBytes(status.installation.downloadedBytes)} of{" "}
            {formatBytes(status.download.bytes)}. You can close this panel; the download continues.
          </p>
        </div>
      ) : null}
      {failure ? (
        <p role="alert" className="wrap-anywhere text-destructive">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status?.download && !ready && !configuredError ? (
          <Button className="h-10 px-3" disabled={busy} onClick={() => install.mutate()}>
            {busy ? `Preparing ${name}…` : failure ? "Retry download" : `Download ${name}`}
          </Button>
        ) : null}
        {!busy ? (
          <Button
            className="h-10 px-3"
            variant="outline"
            onClick={() => {
              install.reset();
              void query.refetch();
            }}
          >
            Check again
          </Button>
        ) : null}
      </div>
    </section>
  );
}
