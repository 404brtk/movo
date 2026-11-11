import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Result, Schema } from "effect";
import {
  LiveActivity,
  LiveSnapshot,
  type ChatDetail,
  type ChatScope,
  type ModelChoice,
  type Passage,
} from "../../shared/contracts/ask.ts";
import {
  askKey,
  askQuestion,
  chatOptions,
  createChat,
  defaultModelOptions,
  liveAnswerUrl,
  setChatModel,
  setChatScope,
  stopAnswer,
  transcriptionOptions,
} from "./api.ts";
import { useSetDefaultModel } from "./ask-models.ts";

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, data: string) => {
  const result = Schema.decodeUnknownResult(Schema.fromJsonString(schema))(data);
  return Result.isSuccess(result) ? result.success : null;
};

function useLiveAnswer(chatId: string | null, answering: boolean, mediaId: string | null) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [activity, setActivity] = useState<LiveActivity>(null);
  useEffect(() => {
    if (!chatId || !answering) return undefined;
    const source = new EventSource(liveAnswerUrl(chatId));
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: chatOptions(chatId).queryKey });
      if (mediaId)
        void queryClient.invalidateQueries({ queryKey: transcriptionOptions(mediaId).queryKey });
    };
    source.addEventListener("snapshot", (event) => {
      const snapshot = decodeJson(LiveSnapshot, event.data);
      setText(snapshot?.text ?? "");
      setActivity(snapshot?.activity ?? null);
    });
    source.addEventListener("delta", (event) => {
      const delta = decodeJson(Schema.String, event.data);
      if (delta) setText((current) => current + delta);
    });
    source.addEventListener("activity", (event) =>
      setActivity(decodeJson(LiveActivity, event.data)),
    );
    source.addEventListener("step", () => {
      setText("");
      refresh();
    });
    const finish = () => {
      source.close();
      setText("");
      setActivity(null);
      refresh();
    };
    source.addEventListener("end", finish);
    source.addEventListener("error", finish);
    return () => source.close();
  }, [chatId, answering, mediaId, queryClient]);
  return answering ? { text, activity } : { text: "", activity: null };
}

export function useAskChat({
  mediaId,
  chatId,
  onChatChange,
  scope = null,
}: {
  mediaId: string | null;
  chatId: string | null;
  onChatChange: (chatId: string) => void;
  scope?: ChatScope | null;
}) {
  const queryClient = useQueryClient();
  const chat = useQuery({
    ...chatOptions(chatId ?? ""),
    enabled: chatId !== null,
    refetchInterval: (query) =>
      query.state.data?.messages.at(-1)?.state === "answering" ? 3000 : false,
  });
  const defaultModel = useQuery(defaultModelOptions);
  const detail = chatId ? chat.data : undefined;
  const last = detail?.messages.at(-1);
  const answering = last?.state === "answering";
  const waitingApproval = last?.state === "waiting_approval";
  const live = useLiveAnswer(chatId, answering, mediaId);
  const store = (updated: ChatDetail) => {
    queryClient.setQueryData(chatOptions(updated.chat.id).queryKey, updated);
    void queryClient.invalidateQueries({ queryKey: [...askKey, "chats"] });
    onChatChange(updated.chat.id);
  };
  const send = useMutation({
    mutationFn: async ({ text, passage }: { text: string; passage: Passage | null }) =>
      askQuestion(chatId ?? (await createChat(mediaId, scope)).chat.id, text, passage),
    onSuccess: store,
  });
  const stop = useMutation({ mutationFn: () => stopAnswer(chatId ?? ""), onSuccess: store });
  const setDefault = useSetDefaultModel();
  const chooseModel = useMutation({
    mutationFn: async (choice: ModelChoice): Promise<ChatDetail | null> => {
      if (chatId) return setChatModel(chatId, choice);
      await setDefault.mutateAsync(choice);
      return null;
    },
    onSuccess: (result) => {
      if (result) store(result);
    },
  });
  const chooseScope = useMutation({
    mutationFn: (next: ChatScope | null) => setChatScope(chatId ?? "", next),
    onSuccess: store,
  });
  const model = detail
    ? detail.chat.connectionId
      ? { ...detail.chat, connectionId: detail.chat.connectionId }
      : null
    : (defaultModel.data ?? null);
  return {
    chat,
    detail,
    answering,
    waitingApproval,
    live,
    model,
    modelMissing: detail
      ? detail.chat.connectionId === null
      : defaultModel.isSuccess && !defaultModel.data,
    send,
    stop,
    chooseModel,
    chooseScope,
  };
}

export type AskChatState = ReturnType<typeof useAskChat>;
