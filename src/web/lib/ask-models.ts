import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiConnection,
  AiModel,
  ConnectRequest,
  ModelChoice,
} from "../../shared/contracts/ask.ts";
import {
  askKey,
  connectService,
  connectionModelsOptions,
  connectionsOptions,
  defaultModelOptions,
  disconnectService,
  setDefaultModel,
} from "./api.ts";
import { connectionLabel } from "./ask-view.ts";

export const modelChoice = (connection: AiConnection, model: AiModel): ModelChoice => ({
  connectionId: connection.id,
  modelId: model.id,
  modelName: model.name,
  contextTokens: model.contextTokens,
});

export function useModelGroups({ enabled = true }: { enabled?: boolean } = {}) {
  const connections = useQuery(connectionsOptions);
  const lists = useQueries({
    queries: (connections.data ?? []).map((connection) => ({
      ...connectionModelsOptions(connection.id, connection.kind),
      enabled,
    })),
  });
  return {
    connections,
    groups: (connections.data ?? []).map((connection, index) => ({
      connection,
      label: connectionLabel(connection),
      models: lists[index],
    })),
  };
}

export function useConnectService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ request, modelId }: { request: ConnectRequest; modelId?: string }) => {
      const connection = await connectService(request);
      const models = await queryClient.fetchQuery(
        connectionModelsOptions(connection.id, connection.kind),
      );
      const current = await queryClient.fetchQuery(defaultModelOptions);
      const chosen =
        models.find((model) => model.id === modelId) ??
        (current ? undefined : models.find((model) => model.tools !== "no"));
      if (chosen) await setDefaultModel(modelChoice(connection, chosen));
      return connection;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: askKey }),
  });
}

export function useDisconnectService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectService,
    onSettled: () => queryClient.invalidateQueries({ queryKey: askKey }),
  });
}

export function useSetDefaultModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDefaultModel,
    onSuccess: (choice) => queryClient.setQueryData(defaultModelOptions.queryKey, choice),
  });
}
