import { useId } from "react";
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

const factClassName =
  "inline-flex h-[22px] items-center gap-[3px] rounded-md bg-muted px-2 text-xs text-muted-foreground";

function ModelState({ model, busy }: { model: ModelStatus; busy: boolean }) {
  if (busy) return <span className="font-medium">{activeLabels[model.installation.phase]}</span>;
  if (model.state === "ready") return <StatusIndicator tone="success">Installed</StatusIndicator>;
  if (model.state === "broken")
    return <StatusIndicator tone="warning">Needs repair</StatusIndicator>;
  return <span className="font-medium">{missingLabels[model.installation.phase]}</span>;
}

function modelNote(model: ModelStatus, busy: boolean) {
  if (busy) return "You can keep using Movo. Transcription unlocks when the download is verified.";
  if (model.state === "ready") return "Verified weights in your Hugging Face cache.";
  if (model.state === "missing") return "Download it once to transcribe on this computer.";
  return null;
}

export function ModelCard({ model }: { model: ModelStatus }) {
  const headingId = useId();
  const models = useQuery(modelsOptions);
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (cancel: boolean) =>
      cancel ? cancelModelInstallation(model.id) : installModel(model.id),
    onSuccess: (updated) =>
      queryClient.setQueryData(modelsOptions.queryKey, (current) =>
        current?.map((entry) => (entry.id === updated.id ? updated : entry)),
      ),
  });
  const { phase, downloadedBytes, error } = model.installation;
  const busy = activeModelPhases.includes(phase);
  const note = modelNote(model, busy);
  const failure = action.error?.message ?? error ?? model.message;
  const retry = phase === "failed" || phase === "interrupted";
  const checking = models.isRefetching && !busy;
  return (
    <section aria-labelledby={headingId} className="mt-6 rounded-[14px] p-5 shadow-card">
      <div className="flex items-start gap-3.5">
        <span className="mt-px shrink-0">
          <AccentIcon icon={CpuIcon} size={30} />
        </span>
        <div>
          <h2 id={headingId} className="text-base/[22px] font-semibold tracking-[-0.01em]">
            {model.name}
          </h2>
          <p className="mt-0.5 text-[13px]/5 text-pretty text-muted-foreground">
            {model.description}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={factClassName}>{formatBytes(model.bytes)}</span>
        <span className={factClassName}>{model.license}</span>
        <span className={factClassName}>{model.languages.length} languages</span>
        <a
          href={model.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`${factClassName} hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
        >
          Model source
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} aria-hidden="true" />
        </a>
      </div>
      <div className="mt-[18px] border-t pt-4 text-[12.5px]/[normal] tabular-nums">
        <div className="flex items-center justify-between gap-3">
          <output className="flex leading-[normal]">
            <ModelState model={model} busy={busy} />
          </output>
          {busy && phase !== "checking" ? (
            <span className="text-muted-foreground">
              {formatByteProgress(downloadedBytes, model.bytes)}
            </span>
          ) : null}
        </div>
        {busy && phase !== "checking" ? (
          <Progress
            aria-label={`${model.name} download`}
            value={downloadedBytes}
            max={model.bytes}
            className="mt-2 block"
          />
        ) : null}
        {failure ? (
          <p role="alert" className="mt-2 wrap-anywhere text-destructive">
            {failure}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {note ? <p className="text-pretty text-muted-foreground">{note}</p> : null}
          <div className="ml-auto flex gap-2">
            {busy ? (
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2.5"
                aria-busy={action.isPending}
                disabled={action.isPending}
                onClick={() => action.mutate(true)}
              >
                {action.isPending ? <Spinner /> : null}
                {action.isPending ? "Cancelling…" : "Cancel"}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className={model.state === "missing" ? undefined : "-mr-2.5"}
                aria-busy={checking}
                disabled={checking || action.isPending}
                onClick={() => {
                  action.reset();
                  void models.refetch();
                }}
              >
                {checking ? <Spinner /> : null}
                {checking ? "Checking…" : "Check again"}
              </Button>
            )}
            {!busy && model.state === "missing" ? (
              <Button
                size="sm"
                aria-busy={action.isPending}
                disabled={action.isPending}
                onClick={() => action.mutate(false)}
              >
                {action.isPending ? (
                  <Spinner />
                ) : (
                  <HugeiconsIcon
                    icon={Download04Icon}
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                )}
                {action.isPending ? "Starting…" : retry ? "Retry download" : "Download model"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <Collapsible className="mt-3 text-[12.5px] text-muted-foreground">
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Supported languages
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            aria-hidden="true"
            className="transition-transform duration-150 ease-snappy group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 max-w-[600px] leading-5 text-pretty">
            {model.languages.map((language) => languageNames.of(language) ?? language).join(", ")}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
