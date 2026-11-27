CREATE TABLE `recording_chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`start_ms` integer NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recording_chapters_start_positive" CHECK("recording_chapters"."start_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_chapters_start` ON `recording_chapters` (`media_id`,`start_ms`);--> statement-breakpoint
CREATE TABLE `recording_overviews` (
	`media_id` text PRIMARY KEY NOT NULL,
	`summary` text,
	`key_points` text,
	`summary_source` text,
	`summary_model_name` text,
	`summary_revision` integer,
	`summary_result_revision` integer,
	`summary_updated_at` integer,
	`chapters_source` text,
	`writing_scope` text,
	`writing_part` integer,
	`writing_parts` integer,
	`writing_error` text,
	`writing_error_kind` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `media_search`;--> statement-breakpoint
DELETE FROM `search_passages`;--> statement-breakpoint
DELETE FROM `search_index`;--> statement-breakpoint
CREATE VIRTUAL TABLE `media_search` USING fts5(
	`media_id` UNINDEXED,
	`title`,
	`transcript`,
	`speakers`,
	`summary`,
	tokenize = 'unicode61 remove_diacritics 2'
);
