import { useState } from "react";
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  Delete02Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { ChatId, type ChatScope } from "../../shared/contracts/ask.ts";
import type { LibraryItem, LibraryList } from "../../shared/contracts/library.ts";
import { AccentIcon } from "../components/accent-icon.tsx";
import { AskComposer, AskConversation, type ComposerBlock } from "../components/ask-chat.tsx";
import { AskConnect } from "../components/ask-connect.tsx";
import { ScopePicker } from "../components/ask-scope.tsx";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Spinner } from "../components/spinner.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import {
  askKey,
  chatListOptions,
  connectionsOptions,
  defaultModelOptions,
  deleteChat,
  enqueueTranscription,
  mediaListKey,
  mediaListOptions,
  retryTranscription,
} from "../lib/api.ts";
import { useAskChat } from "../lib/ask-chat.ts";
import { formatDay } from "../lib/format.ts";
import { searchParams } from "../lib/search-params.ts";

export const Route = createFileRoute("/ask")({
  validateSearch: searchParams(Schema.Struct({ chat: Schema.optional(ChatId) })),
  component: AskLibrary,
});

const librarySuggestions = [
  "What was decided across my recordings?",
  "Where does anyone mention a deadline?",
  "Everything said about the budget",
] as const;

function useLibrary() {
  const library = useQuery(mediaListOptions({}));
  const items = library.data?.items ?? [];
  return {
    library,
    recordings: new Map(items.map((item): [string, LibraryItem] => [item.id, item])),
    transcribed: items.filter((item) => item.transcription === "done").length,
  };
}

function useNeedsConnection() {
  const connections = useQuery(connectionsOptions);
  const defaultModel = useQuery(defaultModelOptions);
  return connections.data?.length === 0 && defaultModel.isSuccess && defaultModel.data === null;
}

function useOpenChat() {
  const navigate = useNavigate({ from: "/ask" });
  return (id: string | undefined) => void navigate({ search: id ? { chat: id } : {} });
}

function TranscribeRest({ items }: { items: LibraryList["items"] }) {
  const queryClient = useQueryClient();
  const waiting = items.filter(
    (item) =>
      item.fileRemovedAt === null &&
      (item.transcription === "none" || item.transcription === "stopped"),
  );
  const transcribe = useMutation({
    mutationFn: async () => {
      for (const item of waiting)
        await (item.transcription === "none"
          ? enqueueTranscription(item.id)
          : retryTranscription(item.id));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mediaListKey }),
  });
  if (waiting.length === 0) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2.5 text-foreground"
        aria-busy={transcribe.isPending}
        disabled={transcribe.isPending}
        onClick={() => transcribe.mutate()}
      >
        {transcribe.isPending ? <Spinner /> : null}
        Transcribe the rest
      </Button>
      {transcribe.error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {transcribe.error.message}
        </p>
      ) : null}
    </>
  );
}

function coverage(total: number, transcribed: number) {
  if (total === 0) return "Your library is empty. Import or download a recording first.";
  if (transcribed === total)
    return `All ${total} ${total === 1 ? "recording has" : "recordings have"} a transcript.`;
  const rest = total - transcribed;
  return `${transcribed} of ${total} recordings have a transcript. The other ${rest} ${rest === 1 ? "is" : "are"} matched by title only.`;
}

function LibraryStart() {
  const openChat = useOpenChat();
  const needsConnection = useNeedsConnection();
  const [scope, setScope] = useState<ChatScope | null>(null);
  const { library, transcribed } = useLibrary();
  const chats = useQuery(chatListOptions(null));
  const state = useAskChat({ mediaId: null, chatId: null, onChatChange: openChat, scope });
  const block: ComposerBlock | null =
    library.isSuccess && transcribed === 0
      ? { reason: "Transcribe a recording to ask across your library" }
      : null;
  const items = library.data?.items ?? [];
  return (
    <main className="mx-auto max-w-[800px] px-5 pt-9 pb-16">
      <h1 className="text-[28px]/[34px] font-semibold tracking-[-0.025em]">Ask</h1>
      <p className="mt-1.5 max-w-[620px] text-[14px]/[22px] text-pretty text-muted-foreground">
        Questions across everything you have transcribed. Answers come back with the recordings and
        moments they are from.
      </p>
      {needsConnection ? (
        <div className="mt-6 rounded-[16px] p-5 shadow-card">
          <AskConnect />
        </div>
      ) : (
        <>
          <div className="-mx-3 mt-6">
            <AskComposer
              state={state}
              placeholder="Ask across your library…"
              block={block}
              passage={null}
              onPassageChange={() => undefined}
              leading={<ScopePicker scope={scope} onChange={setScope} />}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
            <p>{library.data ? coverage(items.length, transcribed) : null}</p>
            <TranscribeRest items={items} />
          </div>
          <ul aria-label="Suggestions" className="mt-5 flex flex-wrap gap-2">
            {librarySuggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  disabled={block !== null || state.model === null || state.send.isPending}
                  onClick={() => state.send.mutate({ text: suggestion, passage: null })}
                  className="rounded-[10px] px-3 py-2 text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--color-border)] outline-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {(chats.data?.length ?? 0) > 0 ? (
        <section aria-labelledby="recent-chats" className="mt-10">
          <h2
            id="recent-chats"
            className="mb-1.5 text-xs/[normal] font-medium text-muted-foreground"
          >
            Recent
          </h2>
          <ul className="-mx-2.5">
            {chats.data?.map((chat) => (
              <li key={chat.id}>
                <Link
                  to="/ask"
                  search={{ chat: chat.id }}
                  className="group flex h-15 items-center gap-3.5 rounded-[10px] px-2.5 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="shrink-0">
                    <AccentIcon icon={BubbleChatIcon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm/5 font-medium">{chat.title}</span>
                    <span className="block truncate text-xs/[normal] text-muted-foreground">
                      {chat.recordingCount} {chat.recordingCount === 1 ? "recording" : "recordings"}{" "}
                      · {formatDay(chat.updatedAt)}
                    </span>
                  </span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={16}
                    aria-hidden="true"
                    className="text-muted-foreground group-hover:text-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {chats.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {chats.error.message}
        </p>
      ) : null}
    </main>
  );
}

function ChatMenu({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const openChat = useOpenChat();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteChat(chatId),
    onSuccess: () => {
      setConfirming(false);
      openChat(undefined);
      void queryClient.invalidateQueries({ queryKey: askKey });
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="More actions"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[180px]">
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
            Delete chat…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        icon={Delete02Icon}
        title="Delete this chat?"
        description="The questions and answers are removed. Recordings and transcripts stay."
        keep="Keep"
        confirm="Delete chat"
        pending="Deleting…"
        severity="permanent"
        busy={remove.isPending}
        error={remove.error?.message ?? null}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function LibraryChat({ chatId }: { chatId: string }) {
  const openChat = useOpenChat();
  const needsConnection = useNeedsConnection();
  const { recordings } = useLibrary();
  const state = useAskChat({ mediaId: null, chatId, onChatChange: openChat });
  const detail = state.detail;
  return (
    <main className="mx-auto flex h-[calc(100svh-104px)] max-w-[800px] flex-col px-5 pt-5 sm:h-[calc(100svh-56px)]">
      <div className="-mr-1.5 -ml-2.5 flex items-center justify-between">
        <Link to="/ask" search={{}} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <HugeiconsIcon icon={ArrowLeft02Icon} data-icon="inline-start" aria-hidden="true" />
          Ask
        </Link>
        <ChatMenu chatId={chatId} />
      </div>
      <h1 className="mt-3 truncate border-b pb-4 text-[22px]/[30px] font-semibold tracking-[-0.02em]">
        {detail?.chat.title ?? " "}
      </h1>
      {state.chat.isError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {state.chat.error.message}
        </p>
      ) : null}
      {state.chat.isPending ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading chat…
        </p>
      ) : null}
      <div className="-mx-4 flex min-h-0 flex-1 flex-col">
        <AskConversation state={state} mediaId={null} recordings={recordings} />
      </div>
      {needsConnection ? (
        <div className="mb-4 rounded-[16px] p-5 shadow-card">
          <AskConnect />
        </div>
      ) : (
        <div className="-mx-3 pb-2">
          <AskComposer
            state={state}
            placeholder="Ask across your library…"
            block={null}
            passage={null}
            onPassageChange={() => undefined}
            leading={
              <ScopePicker
                scope={detail?.chat.scope ?? null}
                disabled={state.answering || state.chooseScope.isPending || !detail}
                onChange={(scope) => state.chooseScope.mutate(scope)}
              />
            }
          />
        </div>
      )}
    </main>
  );
}

function AskLibrary() {
  const { chat } = Route.useSearch();
  return chat ? <LibraryChat key={chat} chatId={chat} /> : <LibraryStart />;
}
