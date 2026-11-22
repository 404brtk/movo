import { useId, type ReactNode } from "react";
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  CpuIcon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activeModelPhases, type ModelStatus } from "../../shared/contracts/models.ts";
import { cancelModelInstallation, installModel, modelsOptions } from "../lib/api.ts";
import { formatByteProgress, formatBytes } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button } from "./ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { Progress } from "./ui/progress.tsx";

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const missingLabels = {
  idle: "Not installed",
  checking: "Not installed",
  downloading: "Not installed",
  verifying: "Not installed",
  complete: "Not installed",
  failed: "Download failed",
  cancelled: "Download cancelled.",
  interrupted: "Download interrupted",
} satisfies Record<ModelStatus["installation"]["phase"], string>;
const activeLabels: Record<string, string> = {
  checking: "Checking the model cache…",
  downloading: "Downloading model…",
  verifying: "Verifying download…",
};

const weightsLabels = {
  busy: "Downloading to your Hugging Face cache",
  ready: "Verified in your Hugging Face cache",
  missing: "Not in your Hugging Face cache",
  broken: "Failed verification in your Hugging Face cache",
} satisfies Record<ModelStatus["state"] | "busy", string>;

export function useModelInstallation(model: ModelStatus) {
  const models = useQuery(modelsOptions);
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (cancel: boolean) =>
      cancel ? cancelModelInstallation(model.id) : installModel(model.id),
    onSuccess: (updated) =>
      queryClient.setQueryData(
        modelsOptions.queryKey,
        (current) =>
          current && {
            ...current,
            models: current.models.map((entry) => (entry.id === updated.id ? updated : entry)),
          },
      ),
  });
  const { phase, error } = model.installation;
  return {
    action,
    busy: activeModelPhases.includes(phase),
    failure: model.message ?? action.error?.message ?? error,
    checking: models.isRefetching && !activeModelPhases.includes(phase),
    checkAgain: () => {
      action.reset();
      void models.refetch();
    },
  };
}

type ModelInstallation = ReturnType<typeof useModelInstallation>;

function CheckAgainButton({
  model,
  installation,
}: {
  model: ModelStatus;
  installation: ModelInstallation;
}) {
  const { checking, action, checkAgain } = installation;
  return (
    <Button
      variant={model.state === "broken" ? "outline" : "ghost"}
      size="sm"
      aria-busy={checking}
      disabled={checking || action.isPending}
      onClick={checkAgain}
    >
      {checking ? <Spinner /> : null}
      {checking ? "Checking…" : "Check again"}
    </Button>
  );
}

export function ModelActions({
  model,
  title,
  installation,
  downloadLabel,
  subject,
}: {
  model: ModelStatus;
  title: string;
  installation: ModelInstallation;
  downloadLabel: string;
  subject?: string;
}) {
  const named = (label: string) => (subject ? `${label} ${subject}` : undefined);
  const { action, busy } = installation;
  const { phase } = model.installation;
  const retry = phase === "failed" || phase === "interrupted";
  return (
    <div className="ml-auto flex items-center gap-2 text-[12.5px]/[normal] tabular-nums">
      <output className="flex">
        {busy ? (
          <span className="font-medium">{activeLabels[phase]}</span>
        ) : model.state === "ready" ? (
          <StatusIndicator tone="success">Installed</StatusIndicator>
        ) : model.state === "broken" ? (
          <StatusIndicator tone="warning">Needs repair</StatusIndicator>
        ) : (
          <span className="font-medium">{missingLabels[phase]}</span>
        )}
      </output>
      {busy ? (
        <Button
          variant="ghost"
          size="sm"
          aria-busy={action.isPending}
          aria-label={named("Cancel")}
          disabled={action.isPending}
          onClick={() => action.mutate(true)}
        >
          {action.isPending ? <Spinner /> : null}
          {action.isPending ? "Cancelling…" : "Cancel"}
        </Button>
      ) : model.state === "missing" ? (
        <Button
          size="sm"
          aria-busy={action.isPending}
          aria-label={named(retry ? "Retry download" : downloadLabel)}
          disabled={action.isPending}
          onClick={() => action.mutate(false)}
        >
          {action.isPending ? (
            <Spinner />
          ) : (
            <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" aria-hidden="true" />
          )}
          {action.isPending ? "Starting…" : retry ? "Retry download" : downloadLabel}
        </Button>
      ) : model.state === "broken" ? (
        <CheckAgainButton model={model} installation={installation} />
      ) : null}
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="group -mr-1.5 aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground"
          />
        }
        aria-label={`${title} details`}
      >
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          aria-hidden="true"
          className="transition-transform duration-150 ease-snappy group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
    </div>
  );
}

export function ModelDetails({
  model,
  title,
  installation,
  note,
  className,
}: {
  model: ModelStatus;
  title: string;
  installation: ModelInstallation;
  note: ReactNode;
  className?: string;
}) {
  const { busy, failure } = installation;
  const { phase, downloadedBytes } = model.installation;
  return (
    <div className={cn("text-xs/[18px]", className)}>
      {busy && phase !== "checking" ? (
        <>
          <Progress
            aria-label={`${title} download`}
            value={downloadedBytes}
            max={model.bytes}
            className="mt-2.5 block"
          />
          <p className="mt-1.5 text-muted-foreground tabular-nums">
            {formatByteProgress(downloadedBytes, model.bytes)}
          </p>
        </>
      ) : null}
      {failure ? (
        <p role="alert" className="mt-2 wrap-anywhere text-destructive">
          {failure}
        </p>
      ) : null}
      {note ? <p className="mt-1.5 text-pretty text-muted-foreground">{note}</p> : null}
      <CollapsibleContent>
        <dl className="mt-2.5 grid grid-cols-[76px_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Size</dt>
          <dd className="tabular-nums">{formatBytes(model.bytes)}</dd>
          <dt className="text-muted-foreground">License</dt>
          <dd>{model.license}</dd>
          <dt className="text-muted-foreground">Languages</dt>
          <dd className="text-pretty">
            {model.languages.map((language) => languageNames.of(language) ?? language).join(", ")}
          </dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd>
            <a
              href={model.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Model source
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} aria-hidden="true" />
            </a>
          </dd>
          <dt className="text-muted-foreground">Weights</dt>
          <dd className="flex flex-wrap items-center gap-x-1">
            <span>{weightsLabels[busy ? "busy" : model.state]}</span>
            {busy || model.state === "broken" ? null : (
              <span className="-my-1.5">
                <CheckAgainButton model={model} installation={installation} />
              </span>
            )}
          </dd>
        </dl>
      </CollapsibleContent>
    </div>
  );
}

export function ModelRow({ model }: { model: ModelStatus }) {
  const headingId = useId();
  const installation = useModelInstallation(model);
  const note = installation.busy
    ? "You can keep using Movo. Transcription unlocks when the download is verified."
    : model.state === "missing"
      ? "Download it once to transcribe on this computer."
      : null;
  return (
    <li aria-labelledby={headingId} className="py-3">
      <Collapsible>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <span className="w-[30px] shrink-0 self-start pt-px">
            <AccentIcon icon={CpuIcon} size={20} />
          </span>
          <div className="min-w-[200px] flex-1">
            <h3 id={headingId} className="text-[13.5px]/[normal] font-medium">
              {model.name}
            </h3>
            <p className="mt-px text-xs/[18px] text-pretty text-muted-foreground tabular-nums">
              {model.description} · {formatBytes(model.bytes)}
            </p>
          </div>
          <ModelActions
            model={model}
            title={model.name}
            installation={installation}
            downloadLabel="Download model"
          />
        </div>
        <ModelDetails
          model={model}
          title={model.name}
          installation={installation}
          note={note}
          className="pl-11"
        />
      </Collapsible>
    </li>
  );
}
