CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`duration_seconds` real,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`downloaded_bytes` integer DEFAULT 0 NOT NULL,
	`error` text,
	`media_id` text,
	`owner_pid` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "download_nonnegative_bytes" CHECK("download_jobs"."downloaded_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_jobs_url_unique` ON `download_jobs` (`url`);--> statement-breakpoint
CREATE INDEX `download_queue_order` ON `download_jobs` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `media_items` ADD `source_url` text;