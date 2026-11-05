DROP INDEX `download_jobs_url_unique`;--> statement-breakpoint
ALTER TABLE `download_jobs` ADD `preset` text DEFAULT 'video-1080p' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `download_jobs_url_preset_unique` ON `download_jobs` (`url`,`preset`);