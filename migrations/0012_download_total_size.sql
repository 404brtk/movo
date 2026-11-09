PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`preset` text DEFAULT 'video-1080p' NOT NULL,
	`transcribe` integer DEFAULT false NOT NULL,
	`title` text,
	`duration_seconds` real,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`downloaded_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer,
	`error` text,
	`cleanup_error` text,
	`media_id` text,
	`owner_pid` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "download_nonnegative_bytes" CHECK("__new_download_jobs"."downloaded_bytes" >= 0),
	CONSTRAINT "download_positive_total_bytes" CHECK("__new_download_jobs"."total_bytes" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_download_jobs`("id", "url", "preset", "transcribe", "title", "duration_seconds", "status", "phase", "downloaded_bytes", "total_bytes", "error", "cleanup_error", "media_id", "owner_pid", "created_at", "updated_at") SELECT "id", "url", "preset", "transcribe", "title", "duration_seconds", "status", "phase", "downloaded_bytes", NULL, "error", "cleanup_error", "media_id", "owner_pid", "created_at", "updated_at" FROM `download_jobs`;--> statement-breakpoint
DROP TABLE `download_jobs`;--> statement-breakpoint
ALTER TABLE `__new_download_jobs` RENAME TO `download_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `download_jobs_url_preset_unique` ON `download_jobs` (`url`,`preset`);--> statement-breakpoint
CREATE INDEX `download_queue_order` ON `download_jobs` (`status`,`updated_at`);