import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Alert02Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  File01Icon,
  Key01Icon,
  LaptopIcon,
  StopIcon,
  Tick02Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { MomentIndex } from "../../shared/citations.ts";
import {
  maxQuestionCharacters,
  type ChatMessage,
  type ChatPart,
  type FailureKind,
  type LiveActivity,
  type Passage,
} from "../../shared/contracts/ask.ts";
import type { LibraryItem } from "../../shared/contracts/library.ts";
import {
  chatOptions,
  connectionsOptions,
  decideApproval,
  restoreTranscript,
  transcriptionOptions,
} from "../lib/api.ts";
import type { AskChatState } from "../lib/ask-chat.ts";
import {
  editReceipt,
  editRevision,
  failureActions,
  isEditTool,
  modelChanges,
  proposedChange,
  stepReceipt,
  toolLabel,
} from "../lib/ask-view.ts";
import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { AskMarkdown } from "./ask-markdown.tsx";
import { ModelPicker } from "./ask-model-picker.tsx";
import { AskSources } from "./ask-sources.tsx";
import { Button } from "./ui/button.tsx";

type ToolPart = Extract<ChatPart, { type: "tool" }>;

const failureIcons = {
  busy: Alert02Icon,
  other: Alert02Icon,
  tools: Alert02Icon,
  model: Alert02Icon,
  key: Key01Icon,
  server: LaptopIcon,
} as const satisfies Record<FailureKind, IconSvgElement>;

function Divider({ children, icon }: { children: string; icon?: IconSvgElement | undefined }) {
  return (
    <p className="flex items-center gap-2.5 text-[11.5px]/4 whitespace-nowrap text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      {icon ? <HugeiconsIcon icon={icon} size={13} aria-hidden="true" /> : null}
      {children}
    </p>
  );
}

function ActivityLine({ text }: { text: string }) {
  return (
    <output
      key={text}
      className="ask-fade-in flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
    >
      <HugeiconsIcon icon={File01Icon} size={14} aria-hidden="true" className="shrink-0" />
      <span className="ask-sweep truncate">{text}</span>
    </output>
  );
}

function ReceiptLine({ text }: { text: string }) {
  return (
    <p className="ask-fade-in flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <HugeiconsIcon icon={Tick02Icon} size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  );
}

function ChangePreview({ part }: { part: ToolPart }) {
  const change = proposedChange(part);
  return (
    <p className="text-[12.5px]/[19px] wrap-anywhere">
      {change.before === null ? null : (
        <>
          <del className="text-muted-foreground">{change.before}</del>
          {" → "}
        </>
      )}
      <ins className="no-underline">{change.after || "(removed)"}</ins>
    </p>
  );
}

function EditCard({
  part,
  chatId,
  mediaId,
}: {
  part: ToolPart;
  chatId: string;
  mediaId: string | null;
}) {
  const queryClient = useQueryClient();
  const decideButton = useRef<HTMLButtonElement>(null);
  const waiting = part.state === "waiting_approval";
  const transcription = useQuery({
    ...transcriptionOptions(mediaId ?? ""),
    enabled: mediaId !== null && part.state === "done",
  });
  useEffect(() => {
    if (waiting) decideButton.current?.focus();
  }, [waiting]);
  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      decideApproval(chatId, { approvalId: part.approvalId ?? "", approved }),
    onSuccess: (detail) => queryClient.setQueryData(chatOptions(chatId).queryKey, detail),
  });
  const undo = useMutation({
    mutationFn: () =>
      restoreTranscript(mediaId ?? "", {
        revision: transcription.data?.revision ?? 0,
        target: editRevision(part) ?? 0,
      }),
    onSuccess: () => {
      if (mediaId)
        void queryClient.invalidateQueries({ queryKey: transcriptionOptions(mediaId).queryKey });
    },
  });
  if (part.state === "failed")
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <HugeiconsIcon icon={Alert02Icon} size={13} aria-hidden="true" />
        The change couldn't be made.
      </p>
    );
  const canUndo =
    part.state === "done" &&
    mediaId !== null &&
    editRevision(part) !== null &&
    (part.resultCount ?? 1) > 0;
  const failure = decide.error ?? undo.error;
  return (
    <div
      className={cn(
        "ask-card-in rounded-xl shadow-[inset_0_0_0_1px_var(--color-border)]",
        waiting ? "bg-background p-3 shadow-card" : "bg-subtle px-3 py-2",
      )}
    >
      <div className="flex min-h-6 items-center gap-2">
        {waiting ? null : (
          <HugeiconsIcon
            icon={part.state === "denied" ? Cancel01Icon : Tick02Icon}
            size={14}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
        )}
        <p className={cn("min-w-0 flex-1 text-[13px]", waiting && "font-medium")}>
          {waiting
            ? "Change the transcript?"
            : undo.isSuccess
              ? "Change undone"
              : editReceipt(part)}
        </p>
        {canUndo && !undo.isSuccess ? (
          <Button
            size="xs"
            variant="link"
            className="h-6 px-1 text-[12.5px]"
            disabled={undo.isPending || !transcription.data}
            onClick={() => undo.mutate()}
          >
            <HugeiconsIcon icon={Undo02Icon} data-icon="inline-start" aria-hidden="true" />
            Undo
          </Button>
        ) : null}
      </div>
      <div className="ask-fold" data-folded={waiting ? undefined : ""}>
        <div>
          <div className="pt-1.5">
            <ChangePreview part={part} />
            {waiting ? (
              <div className="mt-3 flex gap-2">
                <Button
                  ref={decideButton}
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(true)}
                >
                  Change
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(false)}
                >
                  Don't change
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {failure ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {failure.message}
        </p>
      ) : null}
    </div>
  );
}

function Answer({
  message,
  live,
  latest,
  chatId,
  mediaId,
  recordings,
  moments,
}: {
  message: ChatMessage;
  live: { text: string; activity: LiveActivity } | null;
  latest: boolean;
  chatId: string;
  mediaId: string | null;
  recordings: ReadonlyMap<string, LibraryItem> | null;
  moments: MomentIndex;
}) {
  const answering = message.state === "answering";
  const titles = recordings
    ? new Map([...recordings].map(([id, item]) => [id, item.title]))
    : undefined;
  const receipt = stepReceipt(message.parts, recordings !== null);
  const runningLabel = live?.activity
    ? toolLabel(live.activity, "now", titles)
    : answering && !live?.text
      ? "Thinking"
      : null;
  return (
    <div className="grid gap-2" aria-busy={answering}>
      {receipt ? <ReceiptLine text={receipt} /> : null}
      {message.parts.map((part, index) =>
        part.type === "text" ? (
          <AskMarkdown key={index} text={part.text} moments={moments} />
        ) : isEditTool(part) ? (
          <EditCard key={index} part={part} chatId={chatId} mediaId={mediaId} />
        ) : null,
      )}
      {live?.text ? <AskMarkdown text={live.text} moments={moments} live /> : null}
      {runningLabel ? <ActivityLine text={runningLabel} /> : null}
      {recordings && !answering ? (
        <AskSources parts={message.parts} recordings={recordings} moments={moments} />
      ) : null}
      {message.state === "stopped" ? (
        <p className="ask-fade-in text-[12px] text-muted-foreground">Stopped</p>
      ) : null}
      {message.state === "failed" && !(latest && message.errorKind) ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <HugeiconsIcon icon={Alert02Icon} size={13} aria-hidden="true" />
          {message.error}
        </p>
      ) : null}
    </div>
  );
}

function PassageChip({ passage, onClear }: { passage: Passage; onClear?: () => void }) {
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-lg bg-tint px-2.5 py-1.5 text-[12.5px]">
      <span className="shrink-0 font-medium text-primary-strong tabular-nums">
        {formatDuration(passage.startMs / 1000)}
      </span>
      <span className="truncate text-foreground">{passage.text}</span>
      {onClear ? (
        <button
          type="button"
          aria-label="Remove the passage"
          onClick={onClear}
          className="ml-auto shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

export function AskConversation({
  state,
  mediaId,
  recordings = null,
}: {
  state: AskChatState;
  mediaId: string | null;
  recordings?: ReadonlyMap<string, LibraryItem> | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [shownSince] = useState(() => Date.now());
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const connections = useQuery(connectionsOptions);
  const { detail } = state;
  if (!detail) return null;
  const changes = modelChanges(detail.messages);
  const moments = new Map(detail.moments.map((moment) => [moment.startMs, moment.mediaId]));
  const firstSeq = detail.messages[0]?.seq ?? 0;
  const lastSeq = detail.messages.at(-1)?.seq;
  const chatIsLocal =
    connections.data?.find((connection) => connection.id === detail.chat.connectionId)?.kind ===
    "server";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => setAwayFromLatest(event.currentTarget.scrollTop < -80)}
        className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain"
      >
        <div className="mb-auto grid gap-4 px-4 py-4">
          {detail.messages.map((message, index) => {
            const previous = detail.messages[index - 1];
            const hiddenStart =
              detail.hiddenBeforeSeq > firstSeq &&
              message.seq >= detail.hiddenBeforeSeq &&
              (previous?.seq ?? 0) < detail.hiddenBeforeSeq;
            const changedModel = changes.get(message.seq);
            return (
              <Fragment key={message.seq}>
                {hiddenStart ? (
                  <Divider>Older messages are no longer visible to the model</Divider>
                ) : null}
                {changedModel ? (
                  <Divider
                    icon={
                      chatIsLocal && changedModel === detail.chat.modelName ? LaptopIcon : undefined
                    }
                  >
                    {`${changedModel} answers from here`}
                  </Divider>
                ) : null}
                {message.role === "user" ? (
                  <div
                    className={cn(
                      "ml-8 grid max-w-[85%] gap-1.5 justify-self-end rounded-[14px] bg-muted px-3 py-2 text-[13.5px]/[21px] wrap-anywhere whitespace-pre-wrap",
                      message.createdAt > shownSince && "ask-rise",
                    )}
                  >
                    {message.passage ? <PassageChip passage={message.passage} /> : null}
                    {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
                  </div>
                ) : (
                  <Answer
                    message={message}
                    live={message.seq === lastSeq ? state.live : null}
                    latest={message.seq === lastSeq}
                    chatId={detail.chat.id}
                    mediaId={mediaId}
                    recordings={recordings}
                    moments={moments}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      {awayFromLatest ? (
        <Button
          variant="outline"
          size="sm"
          className="ask-pill-in absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-card"
          onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <HugeiconsIcon icon={ArrowDown02Icon} data-icon="inline-start" aria-hidden="true" />
          Jump to latest
        </Button>
      ) : null}
    </div>
  );
}

export interface ComposerBlock {
  reason: string;
  action?: { label: string; onClick: () => void } | undefined;
}

const withQuestion = (text: string) => (current: string) =>
  current ? `${text}\n${current}` : text;

export function AskComposer({
  state,
  placeholder,
  block,
  passage,
  onClearPassage,
  composerRef,
  leading,
  footer,
}: {
  state: AskChatState;
  placeholder: string;
  block: ComposerBlock | null;
  passage: Passage | null;
  onClearPassage: () => void;
  composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  leading?: ReactNode;
  footer?: ReactNode;
}) {
  const navigate = useNavigate();
  const ownField = useRef<HTMLTextAreaElement>(null);
  const field = composerRef ?? ownField;
  const [draft, setDraft] = useState("");
  const [queued, setQueued] = useState<{
    text: string;
    passage: Passage | null;
    chatId: string | null;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const connections = useQuery(connectionsOptions);
  const { detail, answering, waitingApproval, send, stop, chooseModel, model } = state;
  const chatId = detail?.chat.id ?? null;
  if (queued && queued.chatId !== chatId) {
    setQueued(null);
    setDraft(withQuestion(queued.text));
  }
  const last = detail?.messages.at(-1);
  const question = detail?.messages.findLast((message) => message.role === "user");
  const failure = last?.state === "failed" && last.errorKind ? last : null;
  const local =
    connections.data?.find((connection) => connection.id === model?.connectionId)?.kind ===
    "server";
  const fieldBlocked = block !== null || waitingApproval;
  const hasMessages = (detail?.messages.length ?? 0) > 0;
  useEffect(() => {
    if (answering || waitingApproval || !queued || send.isPending) return;
    send.mutate(queued, {
      onSuccess: () => setQueued(null),
      onError: () => {
        setQueued(null);
        setDraft(withQuestion(queued.text));
      },
    });
  }, [answering, waitingApproval, queued, send]);
  const submit = () => {
    const text = draft.trim();
    if (!text || fieldBlocked || !model || send.isPending) return;
    if (answering) {
      setQueued({ text, passage, chatId });
      setDraft("");
      onClearPassage();
      return;
    }
    send.mutate(
      { text, passage },
      {
        onSuccess: () => {
          setDraft("");
          onClearPassage();
        },
      },
    );
  };
  const retry = () => {
    const text = question?.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    if (text) send.mutate({ text, passage: question?.passage ?? null });
  };
  const failureAction = failure?.errorKind
    ? {
        label: failureActions[failure.errorKind],
        onClick:
          failure.errorKind === "key"
            ? () => void navigate({ to: "/models" })
            : failure.errorKind === "tools" || failure.errorKind === "model"
              ? () => setPickerOpen(true)
              : retry,
      }
    : null;
  const error = send.error ?? stop.error ?? chooseModel.error;
  const shownPlaceholder = block
    ? block.reason
    : waitingApproval
      ? "Answer the question above to continue"
      : hasMessages
        ? "Ask a follow-up…"
        : placeholder;
  const canSend = draft.trim().length > 0 && !fieldBlocked && model !== null && !send.isPending;
  return (
    <form
      className="px-3 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {failure && failureAction ? (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 px-1 text-[12.5px] text-destructive"
        >
          <HugeiconsIcon
            icon={failureIcons[failure.errorKind ?? "other"]}
            size={14}
            aria-hidden="true"
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 wrap-anywhere">{failure.error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-1 text-foreground"
            onClick={failureAction.onClick}
          >
            {failureAction.label}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 px-1 text-xs wrap-anywhere text-destructive">
          {error.message}
        </p>
      ) : null}
      {queued ? (
        <p className="mb-2 truncate px-1 text-xs text-muted-foreground">
          “{queued.text}” is sent when this answer ends.
        </p>
      ) : null}
      <div
        className={cn(
          "rounded-[14px] bg-background shadow-[inset_0_0_0_1px_var(--color-input)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_var(--color-ring),0_0_0_3px_color-mix(in_oklab,var(--color-ring)_18%,transparent)]",
          fieldBlocked && "bg-subtle",
        )}
      >
        {passage ? (
          <div className="flex px-2 pt-2">
            <PassageChip passage={passage} onClear={onClearPassage} />
          </div>
        ) : null}
        <textarea
          ref={field}
          aria-label={placeholder}
          placeholder={shownPlaceholder}
          value={draft}
          maxLength={maxQuestionCharacters}
          disabled={fieldBlocked}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && answering) {
              event.preventDefault();
              stop.mutate();
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="block field-sizing-content max-h-[154px] min-h-[46px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px]/[22px] outline-none placeholder:text-muted-foreground disabled:cursor-default"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {leading}
          {block?.action ? null : (
            <ModelPicker
              value={model}
              local={local}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              disabled={answering || chooseModel.isPending}
              onChoose={(choice) => chooseModel.mutate(choice)}
            />
          )}
          <span className="flex-1" />
          {block?.action ? (
            <Button type="button" size="sm" variant="outline" onClick={block.action.onClick}>
              {block.action.label}
            </Button>
          ) : answering ? (
            <Button
              key="stop"
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Stop answering"
              title="Stop (Esc)"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
              className="ask-swap size-8 rounded-[10px]"
            >
              <HugeiconsIcon icon={StopIcon} aria-hidden="true" />
            </Button>
          ) : (
            <Button
              key="send"
              type="submit"
              size="icon-sm"
              aria-label="Send"
              aria-busy={send.isPending}
              disabled={!canSend}
              className="ask-swap size-8 rounded-[10px]"
            >
              <HugeiconsIcon icon={ArrowUp02Icon} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {footer}
    </form>
  );
}
