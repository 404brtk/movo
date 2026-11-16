DROP TRIGGER `search_passages_insert`;--> statement-breakpoint
DROP TRIGGER `search_passages_delete`;--> statement-breakpoint
DROP TRIGGER `search_passages_update`;--> statement-breakpoint
DROP TABLE `passage_search`;--> statement-breakpoint
DROP TABLE `media_search`;--> statement-breakpoint
DELETE FROM `search_passages`;--> statement-breakpoint
DELETE FROM `search_index`;--> statement-breakpoint
ALTER TABLE `search_passages` ADD `speaker` text;--> statement-breakpoint
ALTER TABLE `search_passages` ADD `speaker_search_text` text;--> statement-breakpoint
CREATE VIRTUAL TABLE `media_search` USING fts5(
	`media_id` UNINDEXED,
	`title`,
	`transcript`,
	`speakers`,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `passage_search` USING fts5(
	`search_text`,
	`speaker_search_text`,
	content = 'search_passages',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `search_passages_insert` AFTER INSERT ON `search_passages` BEGIN
	INSERT INTO `passage_search` (`rowid`, `search_text`, `speaker_search_text`) VALUES (new.`id`, new.`search_text`, new.`speaker_search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_passages_delete` AFTER DELETE ON `search_passages` BEGIN
	INSERT INTO `passage_search` (`passage_search`, `rowid`, `search_text`, `speaker_search_text`) VALUES ('delete', old.`id`, old.`search_text`, old.`speaker_search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_passages_update` AFTER UPDATE ON `search_passages` BEGIN
	INSERT INTO `passage_search` (`passage_search`, `rowid`, `search_text`, `speaker_search_text`) VALUES ('delete', old.`id`, old.`search_text`, old.`speaker_search_text`);
	INSERT INTO `passage_search` (`rowid`, `search_text`, `speaker_search_text`) VALUES (new.`id`, new.`search_text`, new.`speaker_search_text`);
END;
