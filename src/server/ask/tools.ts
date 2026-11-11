import { jsonSchema, tool, type ToolSet } from "ai";
import { Effect, Predicate, Result, Schema } from "effect";
import { Tool } from "effect/ai";
import type { ChatScope } from "../../shared/contracts/ask.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { MediaError } from "../media/error.ts";
import type { toolHandlers } from "../mcp/server.ts";
import { defaultListLimit, movoTools } from "../mcp/tools.ts";

export const chatReadTools = [
  "search_library",
  "get_recording",
  "read_transcript",
  "list_transcript_changes",
] as const;
export const chatEditTools = [
  "edit_transcript",
  "replace_in_transcript",
  "assign_speaker",
  "merge_speakers",
  "rename_speaker",
] as const;
type ChatToolName = (typeof chatReadTools)[number] | (typeof chatEditTools)[number];
type Handlers = ReturnType<typeof toolHandlers>;
export interface ToolScope {
  mediaId: string | null;
  library: ChatScope | null;
  pagePassages: number;
}
type FindRecording = (mediaId: string) => Effect.Effect<MediaItem, MediaError>;

const isEditTool = (name: ChatToolName) => chatEditTools.some((editTool) => editTool === name);

const withoutNulls = (input: unknown) =>
  Predicate.isObject(input)
    ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null))
    : input;

const decodeInput = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(withoutNulls(input)).pipe(
    Effect.mapError(
      (cause) => new MediaError("invalid", `The tool input is invalid: ${String(cause)}`, cause),
    ),
  );

const outsideScope = () =>
  Effect.fail(new MediaError("invalid", "This recording is outside the chat's scope."));

const withinScope = (scope: ToolScope, mediaId: string, find: FindRecording) => {
  if (scope.mediaId !== null)
    return scope.mediaId === mediaId
      ? Effect.void
      : Effect.fail(
          new MediaError("invalid", "This chat can only use the recording it belongs to."),
        );
  const { kind, mediaIds } = scope.library ?? {};
  if (mediaIds && !mediaIds.includes(mediaId)) return outsideScope();
  if (!kind) return Effect.void;
  return find(mediaId).pipe(
    Effect.flatMap((item) => (item.kind === kind ? Effect.void : outsideScope())),
  );
};

const inScope = (scope: ToolScope, item: { id: string; kind: string }) => {
  if (scope.mediaId !== null) return item.id === scope.mediaId;
  const { kind, mediaIds } = scope.library ?? {};
  return (!kind || item.kind === kind) && (!mediaIds || mediaIds.includes(item.id));
};

const narrowed = (scope: ToolScope) => scope.mediaId !== null || Boolean(scope.library);

const runners = (
  handlers: Handlers,
  find: FindRecording,
): Record<
  ChatToolName,
  (input: unknown, scope: ToolScope) => Effect.Effect<unknown, MediaError>
> => ({
  search_library: (input, scope) =>
    decodeInput(movoTools.tools.search_library.parametersSchema, input).pipe(
      Effect.flatMap((query) => {
        const kind = scope.library?.kind ? { kind: scope.library.kind } : {};
        if (!narrowed(scope)) return handlers.search_library({ ...query, ...kind });
        const { limit = defaultListLimit, offset = 0, ...filters } = query;
        return handlers
          .search_library({ ...filters, ...kind, limit: Number.MAX_SAFE_INTEGER })
          .pipe(
            Effect.map((found) => {
              const own = found.items.filter((item) => inScope(scope, item));
              return {
                items: own.slice(offset, offset + limit),
                total: own.length,
                transcribing: found.transcribing,
              };
            }),
          );
      }),
    ),
  get_recording: (input, scope) =>
    decodeInput(movoTools.tools.get_recording.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap(handlers.get_recording),
    ),
  read_transcript: (input, scope) =>
    decodeInput(movoTools.tools.read_transcript.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap((request) =>
        handlers.read_transcript({
          ...request,
          maxPassages: Math.min(request.maxPassages ?? scope.pagePassages, scope.pagePassages),
        }),
      ),
    ),
  list_transcript_changes: (input, scope) =>
    decodeInput(movoTools.tools.list_transcript_changes.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap(handlers.list_transcript_changes),
    ),
  edit_transcript: (input, scope) =>
    decodeInput(movoTools.tools.edit_transcript.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap(handlers.edit_transcript),
    ),
  assign_speaker: (input, scope) =>
    decodeInput(movoTools.tools.assign_speaker.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap(handlers.assign_speaker),
    ),
  merge_speakers: (input, scope) =>
    decodeInput(movoTools.tools.merge_speakers.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap(handlers.merge_speakers),
    ),
  rename_speaker: (input, scope) =>
    decodeInput(movoTools.tools.rename_speaker.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap(handlers.rename_speaker),
    ),
  replace_in_transcript: (input, scope) =>
    decodeInput(movoTools.tools.replace_in_transcript.parametersSchema, input).pipe(
      Effect.tap((request) => withinScope(scope, request.mediaId, find)),
      Effect.flatMap((request) =>
        handlers.replace_in_transcript(request).pipe(
          Effect.flatMap((summary) =>
            summary && summary.revision !== request.revision
              ? handlers.list_transcript_changes({ mediaId: request.mediaId, limit: 1 }).pipe(
                  Effect.map(({ changes }) => {
                    const latest = changes[0];
                    return {
                      ...summary,
                      replacementCount:
                        latest && latest.kind === "replace" ? latest.replacementCount : 0,
                    };
                  }),
                )
              : Effect.succeed({ ...summary, replacementCount: 0 }),
          ),
        ),
      ),
    ),
});

async function settle(operation: Effect.Effect<unknown, MediaError>, signal?: AbortSignal) {
  const result = await Effect.runPromise(Effect.result(operation), { signal });
  if (Result.isFailure(result)) throw new Error(result.failure.message, { cause: result.failure });
  return result.success;
}

export function chatToolNames(mediaId: string | null): readonly ChatToolName[] {
  return mediaId === null ? chatReadTools : [...chatReadTools, ...chatEditTools];
}

export function chatTools(handlers: Handlers, find: FindRecording, scope: ToolScope): ToolSet {
  const run = runners(handlers, find);
  return Object.fromEntries(
    chatToolNames(scope.mediaId).map((name) => {
      const definition = movoTools.tools[name];
      return [
        name,
        tool({
          description: Tool.getDescription(definition) ?? name,
          inputSchema: jsonSchema(Tool.getJsonSchema(definition)),
          needsApproval: isEditTool(name),
          execute: (input, { abortSignal }) => settle(run[name](input, scope), abortSignal),
        }),
      ];
    }),
  );
}
