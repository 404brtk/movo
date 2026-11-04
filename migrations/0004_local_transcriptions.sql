CREATE TABLE `transcription_jobs` (
	`media_id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`transcript` text,
	`error` text,
	`cleanup_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transcription_queue_order` ON `transcription_jobs` (`status`,`updated_at`);