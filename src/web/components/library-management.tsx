import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import { toggleSelection } from "../lib/library-selection.ts";
import { CleanupNotice } from "./confirm-dialog.tsx";

type LibraryManagementValue = {
  selected: ReadonlySet<string>;
  selectedItems: readonly LibraryItem[];
  allSelected: boolean;
  toggle: (id: string, extend: boolean) => void;
  select: (id: string) => void;
  setAll: (checked: boolean) => void;
  deselect: (ids: readonly string[]) => void;
  clear: () => void;
  reportCleanup: (message: string) => void;
};

const LibraryManagementContext = createContext<LibraryManagementValue | null>(null);

export function useLibraryManagement() {
  const value = useContext(LibraryManagementContext);
  if (!value) throw new Error("Library rows must be rendered inside LibraryManagement.");
  return value;
}

const noSelection: ReadonlySet<string> = new Set();

const isInsidePopup = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, [role=dialog], [role=alertdialog], [role=menu]") !== null;

export function LibraryManagement({
  items,
  scope,
  children,
}: {
  items: readonly LibraryItem[];
  scope: string;
  children: ReactNode;
}) {
  const [state, setState] = useState({ scope, ids: noSelection, anchor: null as string | null });
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  if (state.scope !== scope) setState({ scope, ids: noSelection, anchor: null });
  const current = state.scope === scope ? state : { scope, ids: noSelection, anchor: null };
  const order = items.map((item) => item.id);
  const selectedItems = items.filter((item) => current.ids.has(item.id));
  const selected = new Set(selectedItems.map((item) => item.id));
  const update = (ids: ReadonlySet<string>, anchor: string | null) =>
    setState({ scope, ids, anchor });
  const clear = () => update(noSelection, null);
  const selecting = selected.size > 0;

  useEffect(() => {
    if (!selecting) return undefined;
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isInsidePopup(event.target)) return;
      setState((previous) => ({ ...previous, ids: noSelection, anchor: null }));
    };
    window.addEventListener("keydown", clearOnEscape);
    return () => window.removeEventListener("keydown", clearOnEscape);
  }, [selecting]);

  const value: LibraryManagementValue = {
    selected,
    selectedItems,
    allSelected: selecting && selected.size === order.length,
    toggle: (id, extend) =>
      update(toggleSelection(selected, order, id, current.anchor, extend), id),
    select: (id) => update(new Set([...selected, id]), id),
    setAll: (checked) => update(checked ? new Set(order) : noSelection, null),
    deselect: (ids) =>
      update(new Set([...selected].filter((id) => !ids.includes(id))), current.anchor),
    clear,
    reportCleanup: setCleanupError,
  };

  return (
    <LibraryManagementContext value={value}>
      {children}
      <CleanupNotice
        cleanupError={cleanupError ?? undefined}
        title="Recording deleted"
        acknowledge="Close"
        onAcknowledge={() => setCleanupError(null)}
      />
    </LibraryManagementContext>
  );
}

export function focusRecordingRow(target: HTMLElement | null) {
  requestAnimationFrame(() => {
    const row = target?.isConnected
      ? target
      : document.querySelector<HTMLElement>("[data-row-link]");
    (row ?? document.querySelector<HTMLElement>("input[type=search]"))?.focus();
  });
}
