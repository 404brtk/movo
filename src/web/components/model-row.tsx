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

function ModelState({ model, busy }: { model: ModelStatus; busy: boolean }) {
  if (busy) return <span className="font-medium">{activeLabels[model.installation.phase]}</span>;
  if (model.state === "ready") return <StatusIndicator tone="success">Installed</StatusIndicator>;
  if (model.state === "broken")
    return <StatusIndicator tone="warning">Needs repair</StatusIndicator>;
  return <span className="font-medium">{missingLabels[model.installation.phase]}</span>;
}

const weightsLabels = {
  busy: "Downloading to your Hugging Face cache",
  ready: "Verified in your Hugging Face cache",
  missing: "Not in your Hugging Face cache",
  broken: "Failed verification in your Hugging Face cache",
} satisfies Record<ModelStatus["state"] | "busy", string>;

const roleNotes = {
  transcription: {
    busy: "You can keep using Movo. Transcription unlocks when the download is verified.",
    missing: "Download it once to transcribe on this computer.",
  },
  speakers: {
    busy: "You can keep using Movo. New transcripts label speakers once the download is verified.",
    missing: "Optional. Download it to label who speaks in new transcripts.",
  },
} satisfies Record<ModelStatus["role"], { busy: string; missing: string }>;

function modelNote(model: ModelStatus, busy: boolean) {
  if (busy) return roleNotes[model.role].busy;
  if (model.state === "missing") return roleNotes[model.role].missing;
  return null;
}

export function ModelRow({ model }: { model: ModelStatus }) {
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
  const addOn = model.role === "speakers";
  const checkAgain = (
    <Button
      variant={model.state === "broken" ? "outline" : "ghost"}
      size="sm"
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
  );
  return (
    <li
      aria-labelledby={headingId}
      className={cn("py-3", addOn ? "pt-1 pl-11" : "border-t first:border-t-0")}
    >
      <Collapsible>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          {addOn ? null : (
            <span className="w-[30px] shrink-0 self-start pt-px">
              <AccentIcon icon={CpuIcon} size={20} />
            </span>
          )}
          <div className="min-w-[200px] flex-1">
            <h3 id={headingId} className="text-[13.5px]/[normal] font-medium">
              {model.name}
            </h3>
            <p className="mt-px text-xs/[18px] text-pretty text-muted-foreground">
              {model.description}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[12.5px]/[normal] tabular-nums">
            <output className="flex">
              <ModelState model={model} busy={busy} />
            </output>
            {busy ? (
              <Button
                variant="ghost"
                size="sm"
                aria-busy={action.isPending}
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
            ) : model.state === "broken" ? (
              checkAgain
            ) : null}
            <CollapsibleTrigger
              render={<Button variant="ghost" size="icon-sm" className="group -mr-1.5" />}
              aria-label={`${model.name} details`}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                aria-hidden="true"
                className="transition-transform duration-150 ease-snappy group-data-panel-open:rotate-180"
              />
            </CollapsibleTrigger>
          </div>
        </div>
        <div className={cn("text-xs/[18px]", !addOn && "pl-11")}>
          {busy && phase !== "checking" ? (
            <>
              <Progress
                aria-label={`${model.name} download`}
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
                {model.languages
                  .map((language) => languageNames.of(language) ?? language)
                  .join(", ")}
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
                  <span className="-my-1.5">{checkAgain}</span>
                )}
              </dd>
            </dl>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </li>
  );
}
