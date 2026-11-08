CREATE TABLE `transcript_changes` (
	`media_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`restored_revision` integer,
	`patches` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`media_id`, `revision`),
	FOREIGN KEY (`media_id`) REFERENCES `transcription_jobs`(`media_id`) ON UPDATE no action ON DELETE no action
);
