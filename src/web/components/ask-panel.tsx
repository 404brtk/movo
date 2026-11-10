import { useCallback, useEffect, useRef, useState } from "react";
import {
  AiChat02Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  PencilEdit02Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { maxPassageCharacters, type Passage } from "../../shared/contracts/ask.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import {
  chatListOptions,
  connectionsOptions,
  defaultModelOptions,
  transcriptionOptions,
} from "../lib/api.ts";
import { useAskChat } from "../lib/ask-chat.ts";
import {
  isActiveTranscription,
  type TranscriptionActionMutation,
} from "../lib/transcription-actions.ts";
import { cn } from "../lib/utils.ts";
import { AskComposer, AskConversation, type ComposerBlock } from "./ask-chat.tsx";
import { AskConnect } from "./ask-connect.tsx";
import { MomentContext } from "./ask-markdown.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Kbd } from "./ui/kbd.tsx";

const openKey = "movo.ask.open";
const panelSuggestions = [
  "Summarise this recording",
  "List decisions and action items",
  "What was left open?",
] as const;
type Via = "keyboard" | "pointer";

function readStoredOpen() {
  try {
    return localStorage.getItem(openKey) === "true";
  } catch {
    return false;
  }
}

export function useAskPanelOpen() {
  const [open, setOpenState] = useState(readStoredOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(openKey, String(next));
    } catch {
      return;
    }
  }, []);
  return [open, setOpen] as const;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "input, textarea, select, [contenteditable=true], [role=dialog], [role=alertdialog], [role=menu]",
    ),
  );

export function AskButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant={open ? "secondary" : "outline"}
      size="sm"
      aria-expanded={open}
      aria-keyshortcuts="/"
      onClick={onToggle}
    >
      <HugeiconsIcon icon={AiChat02Icon} data-icon="inline-start" aria-hidden="true" />
      Ask
      {open ? null : (
        <Kbd aria-hidden="true" className="ml-0.5">
          /
        </Kbd>
      )}
    </Button>
  );
}

export function ChatHistory({
  mediaId,
  currentId,
  onSelect,
}: {
  mediaId: string | null;
  currentId: string | null;
  onSelect: (chatId: string) => void;
}) {
  const chats = useQuery(chatListOptions(mediaId));
  const earlier = (chats.data ?? []).filter((chat) => chat.id !== currentId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label="Earlier chats"
        disabled={earlier.length === 0}
      >
        <HugeiconsIcon icon={Clock01Icon} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Earlier chats</DropdownMenuLabel>
          {earlier.map((chat) => (
            <DropdownMenuItem key={chat.id} onClick={() => onSelect(chat.id)}>
              <span className="truncate">{chat.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Selection {
  passage: Passage;
  top: number;
  left: number;
}

function readSelection(): Selection | null {
  const current = window.getSelection();
  const range = current && current.rangeCount > 0 ? current.getRangeAt(0) : null;
  const text = current?.toString().replace(/\s+/gu, " ").trim() ?? "";
  const start = range?.startContainer;
  const element = start instanceof Element ? start : start?.parentElement;
  const passage = element?.closest<HTMLElement>("[data-start-ms]");
  if (!range || !text || !passage?.closest('[aria-label="Timestamped passages"]')) return null;
  const bounds = range.getBoundingClientRect();
  return {
    passage: {
      startMs: Number(passage.dataset.startMs ?? 0),
      text: text.slice(0, maxPassageCharacters),
    },
    top: Math.max(8, bounds.top - 44),
    left: bounds.left + bounds.width / 2,
  };
}

function useTranscriptSelection() {
  const [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => {
    const update = () => setSelection(readSelection());
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update);
    };
  }, []);
  return selection;
}

function SelectionToolbar({
  selection,
  onAsk,
}: {
  selection: Selection;
  onAsk: (passage: Passage) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected text"
      className="ask-fade-in fixed z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[10px] bg-popover p-1 shadow-popover"
      style={{ top: selection.top, left: selection.left }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="text-primary-strong hover:text-primary-strong"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onAsk(selection.passage)}
      >
        <HugeiconsIcon icon={AiChat02Icon} data-icon="inline-start" aria-hidden="true" />
        Ask about this
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          void navigator.clipboard.writeText(selection.passage.text);
          window.getSelection()?.removeAllRanges();
        }}
      >
        <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" aria-hidden="true" />
        Copy
      </Button>
    </div>
  );
}

function EmptyChat({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-4 pb-3">
      <span className="grid size-9 place-items-center rounded-[10px] bg-tint text-primary-strong">
        <HugeiconsIcon icon={AiChat02Icon} size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-[15px]/[22px] font-semibold tracking-[-0.01em]">
          Ask about this recording
        </h3>
        <p className="mt-0.5 text-[13px]/5 text-pretty text-muted-foreground">
          Every answer points to the moment it comes from, so you can hear it for yourself.
        </p>
      </div>
      <ul aria-label="Suggestions" className="grid gap-1.5">
        {panelSuggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(suggestion)}
              className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--color-border)] outline-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45"
            >
              <span className="flex-1">{suggestion}</span>
              <HugeiconsIcon
                icon={ArrowUp02Icon}
                size={14}
                aria-hidden="true"
                className="text-muted-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function transcriptBlock(
  loaded: boolean,
  job: TranscriptionJob | null | undefined,
  item: MediaItem,
  transcribe: TranscriptionActionMutation,
): ComposerBlock | null {
  if (!loaded || job?.transcript) return null;
  if (isActiveTranscription(job)) return { reason: "Ask opens once the transcript is ready" };
  if (item.fileRemovedAt !== null)
    return { reason: "This recording has no transcript to ask about" };
  return {
    reason: "Transcribe this recording to ask about it",
    action: { label: "Transcribe", onClick: () => transcribe.mutate(job ? "retry" : "start") },
  };
}

export function AskPanel({
  item,
  open,
  onOpenChange,
  transcribe,
}: {
  item: MediaItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transcribe: TranscriptionActionMutation;
}) {
  const panel = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [via, setVia] = useState<Via>("pointer");
  const [leaving, setLeaving] = useState(false);
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [passage, setPassage] = useState<Passage | null>(null);
  const chats = useQuery(chatListOptions(item.id));
  const connections = useQuery(connectionsOptions);
  const defaultModel = useQuery(defaultModelOptions);
  const transcription = useQuery(transcriptionOptions(item.id));
  const chatId = selected === undefined ? (chats.data?.[0]?.id ?? null) : selected;
  const state = useAskChat({ mediaId: item.id, chatId, onChatChange: setSelected });
  const selection = useTranscriptSelection();

  const change = useCallback(
    (next: boolean, how: Via) => {
      setVia(how);
      setLeaving(!next && how === "pointer");
      onOpenChange(next);
      if (next) requestAnimationFrame(() => composer.current?.focus());
    },
    [onOpenChange],
  );

  useEffect(() => {
    const openOnSlash = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || isTyping(event.target)) return;
      event.preventDefault();
      change(true, "keyboard");
    };
    window.addEventListener("keydown", openOnSlash);
    return () => window.removeEventListener("keydown", openOnSlash);
  }, [change]);

  const { answering, stop } = state;
  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (event: KeyboardEvent) => {
      const inside = event.target instanceof Node && panel.current?.contains(event.target);
      if (event.key !== "Escape" || event.defaultPrevented || !inside) return;
      if (answering) stop.mutate();
      else change(false, "keyboard");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, answering, stop, change]);

  const askAbout = (quoted: Passage) => {
    setPassage(quoted);
    window.getSelection()?.removeAllRanges();
    change(true, "pointer");
  };
  const toolbar = selection ? <SelectionToolbar selection={selection} onAsk={askAbout} /> : null;
  if (!open && !leaving) return toolbar;

  const needsConnection =
    connections.data?.length === 0 && defaultModel.isSuccess && defaultModel.data === null;
  const block = transcriptBlock(transcription.isSuccess, transcription.data, item, transcribe);
  const hasMessages = (state.detail?.messages.length ?? 0) > 0;
  const closeOnSmallScreens = () => {
    if (window.matchMedia("(max-width: 699px)").matches) change(false, "pointer");
  };
  return (
    <>
      {toolbar}
      <aside
        ref={panel}
        aria-label="Ask about this recording"
        aria-hidden={!open || undefined}
        onAnimationEnd={(event) => {
          if (leaving && event.target === event.currentTarget) setLeaving(false);
        }}
        className={cn(
          "fixed inset-0 z-40 flex flex-col bg-background min-[700px]:inset-auto min-[700px]:top-16 min-[700px]:right-4 min-[700px]:bottom-4 min-[700px]:w-[392px] min-[700px]:rounded-[16px] min-[700px]:shadow-sheet",
          open ? via === "pointer" && "ask-panel-in" : "ask-panel-out pointer-events-none",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-0.5 border-b pr-2 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">Ask</h2>
          {needsConnection ? null : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New chat"
                disabled={chatId === null}
                onClick={() => {
                  setSelected(null);
                  requestAnimationFrame(() => composer.current?.focus());
                }}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden="true" />
              </Button>
              <ChatHistory mediaId={item.id} currentId={chatId} onSelect={setSelected} />
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close Ask"
            onClick={() => change(false, "pointer")}
          >
            <HugeiconsIcon
              icon={needsConnection ? Cancel01Icon : SidebarRight01Icon}
              aria-hidden="true"
            />
          </Button>
        </div>
        <MomentContext value={closeOnSmallScreens}>
          {needsConnection ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AskConnect />
            </div>
          ) : (
            <>
              {hasMessages ? (
                <AskConversation state={state} mediaId={item.id} />
              ) : (
                <EmptyChat
                  disabled={block !== null || state.model === null || state.send.isPending}
                  onAsk={(question) => state.send.mutate({ text: question, passage: null })}
                />
              )}
              <AskComposer
                state={state}
                placeholder="Ask about this recording…"
                block={block}
                passage={passage}
                onClearPassage={() => setPassage(null)}
                composerRef={composer}
                footer={
                  <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                    Answers can be wrong. Check them against the timestamps.
                  </p>
                }
              />
            </>
          )}
        </MomentContext>
      </aside>
    </>
  );
}
