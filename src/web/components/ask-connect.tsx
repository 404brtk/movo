import { useId, useState } from "react";
import { InformationCircleIcon, Key01Icon, LaptopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  providerKinds,
  providerNames,
  type LocalServer,
  type ProviderKind,
} from "../../shared/contracts/ask.ts";
import { localServersOptions } from "../lib/api.ts";
import { useConnectService } from "../lib/ask-models.ts";
import { cn } from "../lib/utils.ts";
import { ProviderKeyForm } from "./ask-key-form.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";

function CardTitle({
  icon,
  title,
  description,
}: {
  icon: IconSvgElement;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-background text-muted-foreground shadow-raised">
        <HugeiconsIcon icon={icon} size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">{title}</p>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

const cardClassName = (first: boolean) =>
  cn(
    "rounded-[14px] p-3.5",
    first
      ? "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ring)_35%,transparent),0_0_0_3px_color-mix(in_oklab,var(--color-ring)_8%,transparent)]"
      : "shadow-[inset_0_0_0_1px_var(--color-border)]",
  );

function LocalServerCard({ server, first }: { server: LocalServer; first: boolean }) {
  const id = useId();
  const [modelId, setModelId] = useState(server.modelIds[0] ?? "");
  const connect = useConnectService();
  const count = server.modelIds.length;
  return (
    <section aria-label={`${server.name} on this computer`} className={cardClassName(first)}>
      <CardTitle
        icon={LaptopIcon}
        title={`${server.name} on this computer`}
        description={
          count === 0 ? (
            <StatusIndicator tone="idle">Running · no model loaded</StatusIndicator>
          ) : (
            <StatusIndicator tone="success">
              {`Running · ${count} ${count === 1 ? "model" : "models"}`}
            </StatusIndicator>
          )
        }
      />
      {count > 0 ? (
        <div className="mt-3 flex gap-2">
          <label htmlFor={id} className="sr-only">
            Model
          </label>
          <NativeSelect
            id={id}
            size="sm"
            className="min-w-0 flex-1 [&_select]:h-8 [&_select]:text-[13px]"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            {server.modelIds.map((model) => (
              <NativeSelectOption key={model} value={model}>
                {model}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            aria-busy={connect.isPending}
            disabled={connect.isPending}
            onClick={() =>
              connect.mutate({ request: { kind: "server", baseUrl: server.baseUrl }, modelId })
            }
          >
            {connect.isPending ? <Spinner /> : null}
            Use it
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Load a model in {server.name} to ask with it.
        </p>
      )}
      {connect.error ? (
        <p role="alert" className="mt-2 text-xs wrap-anywhere text-destructive">
          {connect.error.message}
        </p>
      ) : (
        <p className="mt-2.5 text-xs/[18px] text-pretty text-muted-foreground">
          Private: nothing leaves this computer. Answers come slower and simpler than from cloud
          models.
        </p>
      )}
    </section>
  );
}

function NothingLocalCard() {
  const local = useQuery(localServersOptions);
  return (
    <section aria-label="Run a model on this computer" className={cardClassName(false)}>
      <CardTitle
        icon={LaptopIcon}
        title="Run a model on this computer"
        description="Free and private, with Ollama, LM Studio or Jan"
      />
      <div className="mt-3 flex gap-2">
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Get Ollama
        </a>
        <Button
          variant="ghost"
          size="sm"
          aria-busy={local.isFetching}
          disabled={local.isFetching}
          onClick={() => void local.refetch()}
        >
          {local.isFetching ? <Spinner /> : null}
          {local.isFetching ? "Checking…" : "Check again"}
        </Button>
      </div>
      <p className="mt-2.5 text-xs/[18px] text-pretty text-muted-foreground">
        None is running right now. Open one and it shows up here within a few seconds.
      </p>
    </section>
  );
}

function KeyCard({ first }: { first: boolean }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  return (
    <section aria-label="Use an API key" className={cardClassName(first)}>
      <CardTitle
        icon={Key01Icon}
        title="Use an API key"
        description="Stronger answers, billed by the provider"
      />
      <div className="mt-3 grid gap-2.5 [&_[role=group]]:w-full [&_[role=group]>*]:flex-1">
        <SegmentedChoice
          label="Service"
          options={providerKinds.map((value) => [value, providerNames[value]] as const)}
          value={kind}
          onValueChange={setKind}
        />
        <ProviderKeyForm key={kind} kind={kind} linkText={first ? "Get a key on" : "Get a key"} />
      </div>
    </section>
  );
}

export function AskConnect() {
  const local = useQuery(localServersOptions);
  const servers = local.data ?? [];
  const localFirst = servers.length > 0;
  return (
    <div className="flex min-h-full flex-col gap-4">
      <div>
        <h3 className="text-[17px]/6 font-semibold tracking-[-0.01em]">Connect a model</h3>
        <p className="mt-1 text-[13px]/5 text-pretty text-muted-foreground">
          Ask needs a model to answer with. Pick one now — you can switch in any chat, or later in
          Models.
        </p>
      </div>
      {local.isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Looking for models on this computer…
        </p>
      ) : localFirst ? (
        <>
          {servers.map((server, index) => (
            <LocalServerCard key={server.baseUrl} server={server} first={index === 0} />
          ))}
          <KeyCard first={false} />
        </>
      ) : (
        <>
          <KeyCard first />
          <NothingLocalCard />
        </>
      )}
      <p className="mt-auto flex gap-2.5 rounded-xl bg-subtle px-3.5 py-3 text-xs/[18px] text-muted-foreground">
        <HugeiconsIcon
          icon={InformationCircleIcon}
          size={15}
          aria-hidden="true"
          className="mt-px shrink-0"
        />
        Your question and the transcript pages it reads go to the model you connect. Keys stay in
        Movo's data on this computer.
      </p>
    </div>
  );
}
