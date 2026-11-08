CREATE TABLE `transcript_changes` (
	`media_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`restored_revision` integer,
	`patch` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`media_id`, `revision`),
	FOREIGN KEY (`media_id`) REFERENCES `transcription_jobs`(`media_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `transcription_jobs` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transcription_jobs` ADD `result_revision` integer DEFAULT 0 NOT NULL;