ALTER TABLE `media_items` ADD `source_preset` text;--> statement-breakpoint
UPDATE `media_items` SET `source_preset` = (SELECT `preset` FROM `download_jobs` WHERE `download_jobs`.`media_id` = `media_items`.`id` AND `download_jobs`.`url` = `media_items`.`source_url`) WHERE `source_url` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `media_source` ON `media_items` (`source_url`,`source_preset`);
