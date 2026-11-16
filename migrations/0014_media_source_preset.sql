ALTER TABLE `media_items` ADD `source_preset` text;--> statement-breakpoint
CREATE INDEX `media_source` ON `media_items` (`source_url`,`source_preset`);