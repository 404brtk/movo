import type { ModelMessage } from "ai";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import {
  answerStates,
  connectionKinds,
  failureKinds,
  type ChatScope,
  type Passage,
} from "../../shared/contracts/ask.ts";
import { mediaItems } from "../media/media.schema.ts";

export const aiConnections = sqliteTable("ai_connections", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: connectionKinds }).notNull(),
  baseUrl: text("base_url"),
  apiKey: text("api_key"),
  createdAt: integer("created_at").notNull(),
  verifiedAt: integer("verified_at").notNull(),
});

export const askSettings = sqliteTable(
  "ask_settings",
  {
    id: integer("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => aiConnections.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    modelName: text("model_name").notNull(),
    contextTokens: integer("context_tokens"),
  },
  (table) => [check("ask_settings_single_row", sql`${table.id} = 1`)],
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id").references(() => mediaItems.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => aiConnections.id, {
      onDelete: "set null",
    }),
    modelId: text("model_id").notNull(),
    modelName: text("model_name").notNull(),
    contextTokens: integer("context_tokens"),
    toolCutSeq: integer("tool_cut_seq").notNull().default(0),
    contextCutSeq: integer("context_cut_seq").notNull().default(0),
    scope: text("scope", { mode: "json" }).$type<ChatScope>(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("chats_by_media").on(table.mediaId, table.updatedAt)],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    messages: text("messages", { mode: "json" }).$type<ModelMessage[]>().notNull(),
    state: text("state", { enum: answerStates }).notNull(),
    modelName: text("model_name"),
    inputTokens: integer("input_tokens"),
    promptCharacters: integer("prompt_characters"),
    error: text("error"),
    errorKind: text("error_kind", { enum: failureKinds }),
    passage: text("passage", { mode: "json" }).$type<Passage>(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [unique("chat_messages_order").on(table.chatId, table.seq)],
);
