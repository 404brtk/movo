DROP INDEX `download_queue_order`;--> statement-breakpoint
CREATE INDEX `download_queue_order` ON `download_jobs` (`status`,`updated_at`);