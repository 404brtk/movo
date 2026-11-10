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
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
export const modelShortcutLabel = isMac ? "⌘⌥/" : "Ctrl+Alt+/";
const isModelShortcut = (event: KeyboardEvent) =>
  event.code === "Slash" && event.altKey && (isMac ? event.metaKey : event.ctrlKey);
const foldedGroupSize = 8;

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
}: {
  value: Pick<ModelChoice, "connectionId" | "modelId" | "modelName"> | null;
  local: boolean;
  onChoose: (choice: ModelChoice) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const { groups } = useModelGroups({ enabled: open });
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!isModelShortcut(event) || disabled) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [disabled, open, onOpenChange]);
  const terms = search.trim().toLowerCase();
  const shown = groups.map((group) => {
    const all = group.models?.data ?? [];
    const matching = all.filter(
      (model) =>
        !terms ||
        model.name.toLowerCase().includes(terms) ||
        model.id.toLowerCase().includes(terms),
    );
    const folded = !terms && matching.length > foldedGroupSize;
    return { ...group, matching: folded ? [] : matching, folded, total: all.length };
  });
  const choices = shown.flatMap((group) =>
    group.matching
      .filter((model) => model.tools !== "no")
      .map((model) => ({ connection: group.connection, model })),
  );
  const activeChoice = choices[Math.min(active, choices.length - 1)];
  const choose = (connection: AiConnection, model: AiModel) => {
    onChoose(modelChoice(connection, model));
    onOpenChange(false);
    setSearch("");
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSearch("");
      }}
    >
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
      <PopoverContent
        align="start"
        side="top"
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
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive((current) =>
                  choices.length === 0 ? 0 : (current + step + choices.length) % choices.length,
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
                {folded ? (
                  <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                    {total} models — type to find one
                  </p>
                ) : null}
                {matching.map((model) => {
                  const selected =
                    value?.connectionId === connection.id && value.modelId === model.id;
                  const highlighted =
                    activeChoice?.connection.id === connection.id &&
                    activeChoice.model.id === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={model.tools === "no"}
                      onClick={() => choose(connection, model)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-45",
                        highlighted && "bg-primary text-primary-foreground hover:bg-primary",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      {model.tools === "no" ? (
                        <span className="shrink-0 text-[11.5px]">Can't use tools</span>
                      ) : null}
                      {selected ? (
                        <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <Link
          to="/models"
          className="flex items-center gap-2 border-t px-3.5 py-2.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={15} aria-hidden="true" />
          Manage models
        </Link>
      </PopoverContent>
    </Popover>
  );
}
