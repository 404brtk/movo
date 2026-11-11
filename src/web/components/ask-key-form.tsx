import { useId, useRef, useState } from "react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { providerNames, type ProviderKind } from "../../shared/contracts/ask.ts";
import { useConnectService } from "../lib/ask-models.ts";
import { Spinner } from "./spinner.tsx";
import { Button } from "./ui/button.tsx";

export const keyPages = {
  anthropic: { label: "platform.claude.com", url: "https://platform.claude.com/settings/keys" },
  openai: { label: "platform.openai.com", url: "https://platform.openai.com/api-keys" },
  openrouter: { label: "openrouter.ai", url: "https://openrouter.ai/settings/keys" },
} as const satisfies Record<ProviderKind, { label: string; url: string }>;

export function KeyField({
  id,
  label,
  placeholder,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-9 items-center rounded-lg border border-input bg-background pr-1 pl-3 shadow-field focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-disabled:opacity-60 has-aria-invalid:border-destructive">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={input}
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-muted-foreground"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => {
          navigator.clipboard
            .readText()
            .then((text) => onChange(text.trim()))
            .catch(() => input.current?.focus());
        }}
      >
        Paste
      </Button>
    </div>
  );
}

export function ProviderKeyForm({
  kind,
  onDone,
  linkText = "Get a key",
}: {
  kind: ProviderKind;
  onDone?: (() => void) | undefined;
  linkText?: string;
}) {
  const id = useId();
  const [apiKey, setApiKey] = useState("");
  const connect = useConnectService();
  const name = providerNames[kind];
  return (
    <form
      className="grid gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!apiKey.trim()) return;
        connect.mutate(
          { request: { kind, apiKey: apiKey.trim() } },
          {
            onSuccess: () => {
              setApiKey("");
              onDone?.();
            },
          },
        );
      }}
    >
      <KeyField
        id={id}
        label={`${name} API key`}
        placeholder={`Paste your ${name} key`}
        value={apiKey}
        onChange={(value) => {
          setApiKey(value);
          connect.reset();
        }}
        invalid={connect.isError}
        disabled={connect.isPending}
      />
      {connect.error ? (
        <p role="alert" className="text-[12.5px]/[18px] wrap-anywhere text-destructive">
          {connect.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {connect.isPending ? (
          <output className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Spinner /> Checking with {name}…
          </output>
        ) : (
          <a
            href={keyPages[kind].url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline"
          >
            {linkText === "Get a key" ? linkText : `${linkText} ${keyPages[kind].label}`}
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} aria-hidden="true" />
          </a>
        )}
        <span className="flex-1" />
        {onDone ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={connect.isPending}
            onClick={onDone}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          size="sm"
          variant={apiKey.trim() ? "default" : "outline"}
          aria-busy={connect.isPending}
          disabled={connect.isPending || !apiKey.trim()}
        >
          Connect
        </Button>
      </div>
    </form>
  );
}
