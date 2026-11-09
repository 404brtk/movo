import { useState } from "react";
import {
  Alert02Icon,
  CpuIcon,
  RefreshIcon,
  Tick02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  TranscriptionJob,
  TranscriptionPhase,
} from "../../shared/contracts/transcriptions.ts";
import { modelsOptions } from "../lib/api.ts";
import { formatDevice } from "../lib/format.ts";
import { formatDayAndTime } from "../lib/library-view.ts";
import { cn } from "../lib/utils.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { MediaToolsSetup } from "./media-tools-setup.tsx";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const steps = [
  { phase: "preparing", label: "Preparing audio" },
  { phase: "loading", label: "Loading Parakeet Ultra" },
  { phase: "transcribing", label: "Transcribing…" },
] as const satisfies readonly { phase: TranscriptionPhase; label: string }[];
const phaseOrder: TranscriptionPhase[] = [
  "queued",
  "preparing",
  "loading",
  "transcribing",
  "finished",
];

export function NoTranscriptCard({
  title,
  description,
  action,
  pending,
  onStart,
}: {
  title: string;
  description: string;
  action: string;
  pending: boolean;
  onStart: () => void;
}) {
  const models = useQuery(modelsOptions);
  const model = models.data?.[0];
  return (
    <section
      aria-labelledby="transcription-state"
      className="mt-7 flex items-start gap-[18px] rounded-2xl bg-linear-to-b from-tint to-background to-70% p-7 shadow-[inset_0_0_0_1px_oklch(0.62_0.195_257/0.12)] max-sm:flex-col max-sm:p-5"
    >
      <span className="mt-px shrink-0">
        <AccentIcon icon={CpuIcon} size={30} />
      </span>
      <div>
        <h2 id="transcription-state" className="text-[17px]/6 font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <p className="mt-1 max-w-[460px] text-[13.5px]/[21px] text-pretty text-muted-foreground">
          {description}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button aria-busy={pending} disabled={pending} onClick={onStart}>
            {pending ? <Spinner /> : null}
            {pending ? "Starting…" : action}
          </Button>
          {model ? (
            model.state === "ready" ? (
              <span className="text-xs text-muted-foreground">{model.name} · installed</span>
            ) : (
              <Link
                to="/models"
                className="rounded-sm text-xs text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Download {model.name} in Models
              </Link>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StepMarker({ state }: { state: "done" | "current" | "pending" }) {
  if (state === "done")
    return (
      <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[oklch(0.955_0.045_152)] text-success">
        <HugeiconsIcon icon={Tick02Icon} size={13} aria-hidden="true" />
      </span>
    );
  if (state === "current")
    return (
      <span className="size-[22px] shrink-0 animate-spin rounded-full border-2 border-highlight border-t-primary [animation-duration:800ms] motion-reduce:[animation-duration:2.4s]" />
    );
  return (
    <span className="size-[22px] shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--color-border)]" />
  );
}

export function TranscribingCard({
  job,
  cancelling,
  onCancel,
}: {
  job: TranscriptionJob;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const position = phaseOrder.indexOf(job.phase);
  const queued = job.phase === "queued";
  const currentStep = steps[position - 1]?.label;
  return (
    <section
      aria-labelledby="transcription-state"
      className="mt-7 rounded-2xl px-7 py-6 shadow-card max-sm:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="transcription-state" className="text-[17px]/6 font-semibold tracking-[-0.01em]">
            {queued ? "Waiting to transcribe" : "Transcribing"}
          </h2>
          <p className="mt-1 text-[13px]/5 text-pretty text-muted-foreground">
            {queued
              ? "It starts as soon as the transcriber is free. Keep Movo open."
              : "You can browse other recordings while it runs. Keep Movo open."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-busy={cancelling}
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? <Spinner /> : null}
          {cancelling ? "Cancelling…" : "Cancel transcription"}
        </Button>
      </div>
      <output className="sr-only">{queued ? "Waiting to transcribe" : currentStep}</output>
      <ol aria-label="Progress" className="mt-5 grid gap-3">
        {steps.map((step, index) => {
          const state =
            position > index + 1 ? "done" : position === index + 1 ? "current" : "pending";
          return (
            <li
              key={step.phase}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 text-[13.5px]",
                state === "done" && "text-muted-foreground",
                state === "current" && "font-medium",
                state === "pending" && "text-muted-foreground/70",
              )}
            >
              <StepMarker state={state} />
              {step.label}
              {state === "done" ? <span className="sr-only">, done</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-5 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
        <HugeiconsIcon icon={CpuIcon} size={14} aria-hidden="true" />
        {job.device ? `Running on ${formatDevice(job.device)}` : "Running on this computer"}
      </p>
    </section>
  );
}

export function FailedTranscriptionCard({
  job,
  retrying,
  onRetry,
}: {
  job: TranscriptionJob;
  retrying: boolean;
  onRetry: () => void;
}) {
  const [showTools, setShowTools] = useState(false);
  const attempt = formatDayAndTime(job.updatedAt, " at ");
  return (
    <section
      role="alert"
      aria-labelledby="transcription-state"
      className="mt-7 flex gap-4 rounded-2xl bg-linear-to-b from-destructive-subtle to-background to-75% px-7 py-6 shadow-[inset_0_0_0_1px_oklch(0.62_0.25_25/0.2)] max-sm:flex-col max-sm:px-5"
    >
      <span className="mt-px shrink-0">
        <AccentIcon icon={Alert02Icon} size={24} tone="danger" />
      </span>
      <div className="min-w-0">
        <h2 id="transcription-state" className="text-[17px]/6 font-semibold tracking-[-0.01em]">
          {job.status === "interrupted"
            ? "Transcription was interrupted"
            : "Transcription didn’t finish"}
        </h2>
        {job.error ? (
          <p className="mt-1 max-w-[480px] text-[13.5px]/[21px] text-pretty wrap-anywhere">
            {job.error}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {job.device
            ? `Last attempt ran on ${formatDevice(job.device)} · ${attempt}`
            : `Last attempt · ${attempt}`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button aria-busy={retrying} disabled={retrying} onClick={onRetry}>
            {retrying ? (
              <Spinner />
            ) : (
              <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden="true" />
            )}
            {retrying ? "Retrying…" : "Retry transcription"}
          </Button>
          <Popover open={showTools} onOpenChange={setShowTools}>
            <PopoverTrigger render={<Button variant="outline" />}>
              <HugeiconsIcon icon={Wrench01Icon} data-icon="inline-start" aria-hidden="true" />
              Media tools
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[380px] max-w-[calc(100vw-2rem)] gap-0">
              <MediaToolsSetup
                readyMessage="You can retry the transcription."
                onClose={() => setShowTools(false)}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </section>
  );
}
