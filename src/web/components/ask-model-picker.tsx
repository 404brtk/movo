import { useEffect, useRef, useState } from "react";
import {
  ArrowDown01Icon,
  LaptopIcon,
  Search01Icon,
  Settings01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { AiConnection, AiModel, ModelChoice } from "../../shared/contracts/ask.ts";
import { modelChoice, useModelGroups } from "../lib/ask-models.ts";
import { reachLabels } from "../lib/ask-view.ts";
import { cn } from "../lib/utils.ts";
import { Spinner } from "./spinner.tsx";
import { buttonVariants } from "./ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
export const modelShortcutLabel = isMac ? "⌘⌥/" : "Ctrl+Alt+/";
const isModelShortcut = (event: KeyboardEvent) =>
  event.code === "Slash" && event.altKey && (isMac ? event.metaKey : event.ctrlKey);
const foldedGroupSize = 8;
const choiceKey = (connectionId: string, modelId: string) => `${connectionId}\n${modelId}`;

function groupLabel(connection: AiConnection, label: string) {
  if (connection.kind !== "server" || !connection.reach) return label;
  const name = label.replace(/ on .*$/u, "");
  return connection.reach === "this-computer"
    ? `${name} · on this computer`
    : `${name} · ${reachLabels.network.toLowerCase()}`;
}

export function ModelPicker({
  value,
  local,
  onChoose,
  disabled,
  open,
  onOpenChange,
  field,
}: {
  value: Pick<ModelChoice, "connectionId" | "modelId" | "modelName"> | null;
  local: boolean;
  onChoose: (choice: ModelChoice) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field?: { label: string };
}) {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const { groups } = useModelGroups({ enabled: open });
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (field || !isModelShortcut(event) || disabled) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [field, disabled, open, onOpenChange]);
  const terms = search.trim().toLowerCase();
  const chosenKey = value ? choiceKey(value.connectionId, value.modelId) : null;
  const chosenGroup = groups.find((group) => group.connection.id === value?.connectionId);
  const shown = groups.map((group) => {
    const all = group.models?.data ?? [];
    const matching = all.filter(
      (model) =>
        !terms ||
        model.name.toLowerCase().includes(terms) ||
        model.id.toLowerCase().includes(terms),
    );
    const folded = !terms && matching.length > foldedGroupSize;
    const isChosen = (model: AiModel) => choiceKey(group.connection.id, model.id) === chosenKey;
    return {
      ...group,
      matching: folded ? matching.filter(isChosen) : matching,
      folded,
      total: all.length,
    };
  });
  const choices = shown.flatMap((group) =>
    group.matching
      .filter((model) => model.tools !== "no")
      .map((model) => ({
        connection: group.connection,
        model,
        key: choiceKey(group.connection.id, model.id),
      })),
  );
  const indexOf = (key: string | null) => choices.findIndex((choice) => choice.key === key);
  const activeIndex = [indexOf(active), indexOf(chosenKey)].find((index) => index >= 0) ?? 0;
  const activeChoice = choices[activeIndex];
  const choose = (connection: AiConnection, model: AiModel) => {
    onChoose(modelChoice(connection, model));
    onOpenChange(false);
    setSearch("");
    setActive(null);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) return;
        setSearch("");
        setActive(null);
      }}
    >
      {field ? (
        <PopoverTrigger
          disabled={disabled}
          aria-label={`${field.label}: ${value?.modelName ?? "Choose a model"}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "max-w-[320px] min-w-[200px] justify-start font-normal max-sm:w-full max-sm:max-w-none",
          )}
        >
          <span className="min-w-0 truncate font-medium">
            {value?.modelName ?? "Choose a model"}
          </span>
          {chosenGroup ? (
            <span className="min-w-0 shrink-[4] truncate text-muted-foreground">
              {chosenGroup.label}
            </span>
          ) : null}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            aria-hidden="true"
            className="ml-auto text-muted-foreground"
          />
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          disabled={disabled}
          title={`Choose a model (${modelShortcutLabel})`}
          className="inline-flex h-7 max-w-[220px] min-w-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45 aria-expanded:bg-muted aria-expanded:text-foreground"
        >
          {local ? (
            <HugeiconsIcon
              icon={LaptopIcon}
              size={14}
              aria-label="On this computer"
              className="shrink-0"
            />
          ) : null}
          <span className="truncate">{value?.modelName ?? "Choose a model"}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden="true" className="shrink-0" />
        </PopoverTrigger>
      )}
      <PopoverContent
        align={field ? "end" : "start"}
        side={field ? "bottom" : "top"}
        initialFocus={searchInput}
        className="w-[320px] gap-0 p-0"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <HugeiconsIcon
            icon={Search01Icon}
            size={15}
            aria-hidden="true"
            className="text-muted-foreground"
          />
          <input
            ref={searchInput}
            aria-label="Find a model"
            placeholder="Find a model"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(null);
            }}
            onKeyDown={(event) => {
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && choices.length > 0) {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  choices[(activeIndex + step + choices.length) % choices.length]?.key ?? null,
                );
              }
              if (event.key === "Enter" && activeChoice) {
                event.preventDefault();
                choose(activeChoice.connection, activeChoice.model);
              }
            }}
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto overscroll-contain p-1.5">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No model is connected yet.</p>
          ) : null}
          {shown.map(({ connection, label, models, matching, folded, total }) => {
            if (terms && matching.length === 0) return null;
            return (
              <div key={connection.id} className="py-1">
                <p className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] font-medium text-muted-foreground">
                  {connection.kind === "server" ? (
                    <HugeiconsIcon icon={LaptopIcon} size={13} aria-hidden="true" />
                  ) : null}
                  {groupLabel(connection, label)}
                </p>
                {models?.isPending ? (
                  <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <Spinner /> Loading models…
                  </p>
                ) : null}
                {models?.isError ? (
                  <p role="alert" className="px-2 py-1.5 text-xs wrap-anywhere text-destructive">
                    {models.error.message}
                  </p>
                ) : null}
                {matching.map((model) => {
                  const key = choiceKey(connection.id, model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      aria-pressed={key === chosenKey}
                      disabled={model.tools === "no"}
                      onClick={() => choose(connection, model)}
                      onPointerMove={() => setActive(key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:bg-muted disabled:opacity-45",
                        activeChoice?.key === key && "bg-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      {model.tools === "no" ? (
                        <span className="shrink-0 text-[11.5px]">Can't use tools</span>
                      ) : null}
                      {key === chosenKey ? (
                        <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
                {folded ? (
                  <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                    {matching.length > 0
                      ? `${total - matching.length} more — type to find one`
                      : `${total} models — type to find one`}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        {field ? null : (
          <Link
            to="/models"
            className="flex items-center gap-2 border-t px-3.5 py-2.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={Settings01Icon} size={15} aria-hidden="true" />
            Manage models
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
