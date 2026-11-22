import { useId, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import {
  SpeakerModelId,
  type ModelCatalog,
  type ModelStatus,
} from "../../shared/contracts/models.ts";
import { chooseSpeakerLabels, modelsOptions } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";
import { speakerLabelsTitle } from "../lib/speaker-labels.ts";
import { cn } from "../lib/utils.ts";
import { ModelActions, ModelDetails, useModelInstallation } from "./model-row.tsx";
import { Collapsible } from "./ui/collapsible.tsx";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group.tsx";

const off = "off";

function SpeakerOption({
  value,
  title,
  description,
  disabled,
  children,
}: {
  value: string;
  title: string;
  description: ReactNode;
  disabled: boolean;
  children?: ReactNode;
}) {
  const radioId = useId();
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-[200px] flex-1 items-start gap-3">
        <RadioGroupItem
          id={radioId}
          value={value}
          disabled={disabled}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="mt-px"
        />
        <label
          htmlFor={radioId}
          className={cn("min-w-0", disabled ? "cursor-default" : "cursor-pointer")}
        >
          <span id={titleId} className="block text-[13.5px]/5 font-medium">
            {title}
          </span>
          <span
            id={descriptionId}
            className="mt-px block text-xs/[18px] text-pretty text-muted-foreground tabular-nums"
          >
            {description}
          </span>
        </label>
      </div>
      {children}
    </div>
  );
}

function SpeakerModelOption({ model }: { model: ModelStatus }) {
  const installation = useModelInstallation(model);
  const title = speakerLabelsTitle(model);
  return (
    <Collapsible>
      <SpeakerOption
        value={model.id}
        title={title}
        disabled={model.state !== "ready"}
        description={
          <>
            <span className="font-medium text-foreground/80">{model.name}</span> ·{" "}
            {model.description} · {formatBytes(model.bytes)}
          </>
        }
      >
        <ModelActions
          model={model}
          title={title}
          installation={installation}
          downloadLabel="Download"
          subject={model.name}
        />
      </SpeakerOption>
      <ModelDetails
        model={model}
        title={title}
        installation={installation}
        note={
          installation.busy
            ? "New transcripts use it once the download is verified. You can keep using Movo."
            : null
        }
        className="pl-[30px]"
      />
    </Collapsible>
  );
}

export function SpeakerLabels({ catalog }: { catalog: ModelCatalog }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const choice = useMutation({
    mutationFn: chooseSpeakerLabels,
    onMutate: async ({ speakerModelId }) => {
      await queryClient.cancelQueries({ queryKey: modelsOptions.queryKey });
      const previous = queryClient.getQueryData(modelsOptions.queryKey);
      queryClient.setQueryData(
        modelsOptions.queryKey,
        (current) => current && { ...current, speakerModelId },
      );
      return previous;
    },
    onError: (_error, _choice, previous) =>
      queryClient.setQueryData(modelsOptions.queryKey, previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: modelsOptions.queryKey }),
  });
  const speakerModels = catalog.models.filter((model) => model.role === "speakers");
  return (
    <li aria-labelledby={headingId} className="ml-11 pt-1 pb-3 pl-4">
      <div className="relative flex flex-wrap items-baseline gap-x-1.5 before:absolute before:-top-2.5 before:bottom-1/2 before:-left-4 before:w-2.5 before:rounded-bl-[7px] before:border-b-[1.5px] before:border-l-[1.5px] before:border-input">
        <h3 id={headingId} className="text-[13.5px]/[normal] font-medium">
          Speaker labels
        </h3>
        <span className="text-[12.5px]/[normal] text-muted-foreground">Optional</span>
      </div>
      <RadioGroup
        aria-labelledby={headingId}
        value={catalog.speakerModelId ?? off}
        onValueChange={(value) =>
          choice.mutate({ speakerModelId: Schema.is(SpeakerModelId)(value) ? value : null })
        }
        className="mt-3 gap-3.5"
      >
        <SpeakerOption
          value={off}
          title="Off"
          description="New transcripts don’t label speakers"
          disabled={false}
        />
        {speakerModels.map((model) => (
          <SpeakerModelOption key={model.id} model={model} />
        ))}
      </RadioGroup>
      {choice.error ? (
        <p role="alert" className="mt-2.5 text-xs/[18px] wrap-anywhere text-destructive">
          {choice.error.message}
        </p>
      ) : null}
    </li>
  );
}
