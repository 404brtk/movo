CREATE TABLE `ai_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`base_url` text,
	`api_key` text,
	`created_at` integer NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ask_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_name` text NOT NULL,
	`context_tokens` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ask_settings_single_row" CHECK("ask_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`chat_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`messages` text NOT NULL,
	`state` text NOT NULL,
	`model_name` text,
	`input_tokens` integer,
	`prompt_characters` integer,
	`error` text,
	`error_kind` text,
	`passage` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_order` ON `chat_messages` (`chat_id`,`seq`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text,
	`connection_id` text,
	`model_id` text NOT NULL,
	`model_name` text NOT NULL,
	`context_tokens` integer,
	`tool_cut_seq` integer DEFAULT 0 NOT NULL,
	`context_cut_seq` integer DEFAULT 0 NOT NULL,
	`scope` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chats_by_media` ON `chats` (`media_id`,`updated_at`);