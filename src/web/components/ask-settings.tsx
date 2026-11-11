import { useId, useState, type ReactNode } from "react";
import {
  BubbleChatIcon,
  ComputerIcon,
  Delete02Icon,
  Key01Icon,
  LaptopIcon,
  Link01Icon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  providerKinds,
  providerNames,
  type AiConnection,
  type LocalServer,
  type ProviderKind,
} from "../../shared/contracts/ask.ts";
import { addressReach } from "../../shared/server-address.ts";
import { connectionModelsOptions, defaultModelOptions, localServersOptions } from "../lib/api.ts";
import {
  useConnectService,
  useDisconnectService,
  useModelGroups,
  useSetDefaultModel,
} from "../lib/ask-models.ts";
import { connectionLabel, reachLabels } from "../lib/ask-view.ts";
import { AccentIcon } from "./accent-icon.tsx";
import { ProviderKeyForm } from "./ask-key-form.tsx";
import { ModelPicker } from "./ask-model-picker.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { Spinner } from "./spinner.tsx";
import { StatusIndicator } from "./status-indicator.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";

const providerDescriptions = {
  anthropic: "Claude models from Anthropic",
  openai: "GPT models from OpenAI",
  openrouter: "One key for models from many providers",
} as const satisfies Record<ProviderKind, string>;

function Row({
  icon,
  idle,
  title,
  description,
  trailing,
  children,
}: {
  icon: IconSvgElement;
  idle?: boolean;
  title: string;
  description: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="w-[30px] shrink-0">
          {idle ? (
            <HugeiconsIcon
              icon={icon}
              size={20}
              aria-hidden="true"
              className="block text-muted-foreground"
            />
          ) : (
            <AccentIcon icon={icon} size={20} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px]/[normal] font-medium">{title}</p>
          <div className="mt-px truncate text-xs/[normal] text-muted-foreground">{description}</div>
        </div>
        {trailing}
      </div>
      {children ? <div className="pl-11">{children}</div> : null}
    </li>
  );
}

function GroupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-8 mb-1.5">
      <h3 className="text-xs/[normal] font-medium text-muted-foreground">{title}</h3>
      <p className="mt-0.5 text-xs/[18px] text-pretty text-muted-foreground">{description}</p>
    </div>
  );
}

function DefaultModelField() {
  const [open, setOpen] = useState(false);
  const current = useQuery(defaultModelOptions);
  const { groups } = useModelGroups();
  const setDefault = useSetDefaultModel();
  return (
    <ul>
      <Row
        icon={BubbleChatIcon}
        title="New chats answer with"
        description={
          setDefault.error ? (
            <span role="alert" className="text-destructive">
              {setDefault.error.message}
            </span>
          ) : groups.length === 0 ? (
            "Connect a model below to start asking."
          ) : (
            "Any chat can switch from its own field."
          )
        }
        trailing={
          groups.length === 0 ? null : (
            <div className="max-sm:basis-full max-sm:pl-11">
              <ModelPicker
                field={{ label: "New chats answer with" }}
                value={current.data ?? null}
                local={false}
                disabled={setDefault.isPending}
                open={open}
                onOpenChange={setOpen}
                onChoose={(choice) => setDefault.mutate(choice)}
              />
            </div>
          )
        }
      />
    </ul>
  );
}

function RowMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={label}>
        <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.danger ? "destructive" : "default"}
            onClick={item.onSelect}
          >
            <HugeiconsIcon icon={item.danger ? Delete02Icon : RefreshIcon} aria-hidden="true" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RemoveDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: AiConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const disconnect = useDisconnectService();
  const label = connectionLabel(connection);
  const isKey = connection.kind !== "server";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Delete02Icon}
      title={isKey ? `Remove the ${label} key?` : `Remove ${label}?`}
      description={`Chats that used ${isKey ? `${label} models` : "it"} stay readable. To continue one, pick another model in its field.${isKey ? " The key is deleted from Movo's data, not just hidden." : ""}`}
      keep="Cancel"
      confirm={isKey ? "Remove key" : "Remove server"}
      pending="Removing…"
      severity="permanent"
      busy={disconnect.isPending}
      error={disconnect.error?.message ?? null}
      onConfirm={() => disconnect.mutate(connection.id, { onSuccess: () => onOpenChange(false) })}
    />
  );
}

const modelNames = (ids: readonly string[]) =>
  ids.length === 0 ? null : ids.slice(0, 4).join(", ") + (ids.length > 4 ? ", …" : "");

function Address({ baseUrl }: { baseUrl: string }) {
  return <span className="font-mono text-[11.5px]">{new URL(baseUrl).host}</span>;
}

function ServerRow({ connection }: { connection: AiConnection }) {
  const [removing, setRemoving] = useState(false);
  const models = useQuery(connectionModelsOptions(connection.id, connection.kind));
  const names = modelNames(models.data?.map((model) => model.id) ?? []);
  const status = models.isPending ? (
    <StatusIndicator tone="idle">Checking…</StatusIndicator>
  ) : models.isError ? (
    <StatusIndicator tone="warning">Not running</StatusIndicator>
  ) : names ? (
    <StatusIndicator tone="success">Running</StatusIndicator>
  ) : (
    <StatusIndicator tone="idle">Idle</StatusIndicator>
  );
  return (
    <Row
      icon={connection.reach === "network" ? ComputerIcon : LaptopIcon}
      idle={models.isError}
      title={connectionLabel(connection).replace(/ on this computer$/u, "")}
      description={
        <>
          {connection.reach ? reachLabels[connection.reach] : null} ·{" "}
          {connection.baseUrl ? <Address baseUrl={connection.baseUrl} /> : null}
          {" · "}
          {models.isError ? "isn't answering" : (names ?? "no model loaded")}
        </>
      }
      trailing={
        <>
          {status}
          <RowMenu
            label={`More for ${connectionLabel(connection)}`}
            items={[{ label: "Remove server", danger: true, onSelect: () => setRemoving(true) }]}
          />
          <RemoveDialog connection={connection} open={removing} onOpenChange={setRemoving} />
        </>
      }
    />
  );
}

function DetectedRow({ server }: { server: LocalServer }) {
  const connect = useConnectService();
  const names = modelNames(server.modelIds);
  return (
    <Row
      icon={LaptopIcon}
      title={server.name}
      description={
        connect.error ? (
          <span role="alert" className="text-destructive">
            {connect.error.message}
          </span>
        ) : (
          <>
            This computer · <Address baseUrl={server.baseUrl} /> · {names ?? "no model loaded"}
          </>
        )
      }
      trailing={
        names ? (
          <Button
            size="sm"
            variant="outline"
            aria-busy={connect.isPending}
            disabled={connect.isPending}
            onClick={() => connect.mutate({ request: { kind: "server", baseUrl: server.baseUrl } })}
          >
            {connect.isPending ? <Spinner /> : null}
            Use it
          </Button>
        ) : (
          <StatusIndicator tone="idle">Idle</StatusIndicator>
        )
      }
    >
      {names ? null : (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Load a model in {server.name} to ask with it.
        </p>
      )}
    </Row>
  );
}

function AnotherServer() {
  const addressId = useId();
  const keyId = useId();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const connect = useConnectService();
  const reach = addressReach(address);
  const close = () => {
    setOpen(false);
    setAddress("");
    setApiKey("");
    connect.reset();
  };
  const hint = !address.trim()
    ? "This computer or your home network"
    : !reach
      ? "Only this computer or your home network. Add internet services with an API key."
      : reach.reach === "this-computer"
        ? "This computer"
        : reach.encrypted
          ? "Your network"
          : "Your network · questions cross it unencrypted over http";
  return (
    <Row
      icon={Link01Icon}
      idle
      title="Another server"
      description="A computer at home, or a port Movo doesn't check"
      trailing={
        open ? null : (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Add address
          </Button>
        )
      }
    >
      {open ? (
        <form
          className="mt-3 grid gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            connect.mutate(
              { request: { kind: "server", baseUrl: address, ...(apiKey ? { apiKey } : {}) } },
              { onSuccess: close },
            );
          }}
        >
          <label htmlFor={addressId} className="sr-only">
            Server address
          </label>
          <Input
            id={addressId}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="http://192.168.1.20:11434"
            autoComplete="off"
            spellCheck={false}
            required
            className="h-9 font-mono text-[12.5px]"
            aria-invalid={connect.isError || (address.trim() !== "" && !reach) || undefined}
          />
          <label htmlFor={keyId} className="sr-only">
            Key, if the server asks for one
          </label>
          <Input
            id={keyId}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Key, if the server asks for one"
            autoComplete="off"
            className="h-9"
          />
          {connect.error ? (
            <p role="alert" className="text-[12.5px] wrap-anywhere text-destructive">
              {connect.error.message}
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">{hint}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              aria-busy={connect.isPending}
              disabled={connect.isPending || !reach}
            >
              {connect.isPending ? <Spinner /> : null}
              {connect.isPending ? "Checking…" : "Connect"}
            </Button>
          </div>
        </form>
      ) : null}
    </Row>
  );
}

function NoServerFound() {
  const local = useQuery(localServersOptions);
  return (
    <div className="mt-2 ml-11 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--color-border)]">
      <p className="text-[13.5px] font-medium">No model server found</p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        Movo checks Ollama, LM Studio, Jan and llama-server on their usual ports. Opening one is
        enough — it appears here within about 30 seconds while this page is open.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Check again for model servers"
          aria-busy={local.isFetching}
          disabled={local.isFetching}
          onClick={() => void local.refetch()}
        >
          {local.isFetching ? <Spinner /> : null}
          Check again
        </Button>
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Get Ollama
        </a>
      </div>
    </div>
  );
}

function LocalModels({ servers }: { servers: AiConnection[] }) {
  const local = useQuery(localServersOptions);
  const connected = new Set(servers.map((server) => server.baseUrl));
  const detected = (local.data ?? []).filter((server) => !connected.has(server.baseUrl));
  return (
    <>
      <GroupHeading
        title="Local models"
        description="Ollama, LM Studio, Jan and llama-server on this computer are checked while this page is open; anything else is added by its address. Nothing you ask goes to the internet."
      />
      {servers.length === 0 && detected.length === 0 && local.isSuccess ? <NoServerFound /> : null}
      <ul>
        {servers.map((server) => (
          <ServerRow key={server.id} connection={server} />
        ))}
        {detected.map((server) => (
          <DetectedRow key={server.baseUrl} server={server} />
        ))}
        <AnotherServer />
      </ul>
    </>
  );
}

function ProviderRow({ kind, connection }: { kind: ProviderKind; connection?: AiConnection }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const models = useQuery({
    ...connectionModelsOptions(connection?.id ?? "", kind),
    enabled: connection !== undefined,
  });
  const name = providerNames[kind];
  const description = connection
    ? `Key ending ${connection.keyHint}${models.data ? ` · ${models.data.length} models` : ""}`
    : editing
      ? "Paste a key to connect"
      : providerDescriptions[kind];
  return (
    <Row
      icon={Key01Icon}
      idle={!connection && !editing}
      title={name}
      description={description}
      trailing={
        connection ? (
          <>
            <StatusIndicator tone={models.isError ? "warning" : "success"}>
              {models.isError ? "Check the key" : "Connected"}
            </StatusIndicator>
            <RowMenu
              label={`More for ${name}`}
              items={[
                { label: "Replace key", onSelect: () => setEditing(true) },
                { label: "Remove key", danger: true, onSelect: () => setRemoving(true) },
              ]}
            />
            <RemoveDialog connection={connection} open={removing} onOpenChange={setRemoving} />
          </>
        ) : editing ? null : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Add key
          </Button>
        )
      }
    >
      {editing ? (
        <div className="mt-3">
          <ProviderKeyForm
            kind={kind}
            linkText="Create a key on"
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </Row>
  );
}

function WhatIsSent() {
  const rows = [
    [
      "Sent",
      "Your question, the passage you selected, and the transcript pages the model asks to read",
    ],
    ["Never sent", "The media file, your keys, other recordings while you ask in the panel"],
    ["Local model", "Nothing leaves this computer, or your home network for a server on it"],
  ] as const;
  return (
    <dl className="mt-8 grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-subtle px-4 py-3.5 text-[12.5px]/[18px] shadow-[inset_0_0_0_1px_var(--color-border)] max-sm:grid-cols-1">
      {rows.map(([term, detail]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-pretty max-sm:mb-1.5">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AskSettings() {
  const headingId = useId();
  const { connections } = useModelGroups({ enabled: true });
  const all = connections.data ?? [];
  return (
    <section aria-labelledby={headingId} className="mt-12">
      <h2 id={headingId} className="text-[17px]/6 font-semibold tracking-[-0.01em]">
        Ask
      </h2>
      {connections.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {connections.error.message}
        </p>
      ) : null}
      <DefaultModelField />
      <LocalModels servers={all.filter((connection) => connection.kind === "server")} />
      <GroupHeading
        title="With an API key"
        description="Billed by the provider for what you ask. Keys are kept in Movo's data on this computer, readable only by your account, and go only to their own provider."
      />
      <ul>
        {providerKinds.map((kind) => {
          const connection = all.find((entry) => entry.kind === kind);
          return connection ? (
            <ProviderRow key={kind} kind={kind} connection={connection} />
          ) : (
            <ProviderRow key={kind} kind={kind} />
          );
        })}
      </ul>
      <WhatIsSent />
    </section>
  );
}
