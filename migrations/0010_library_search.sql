CREATE TABLE `search_index` (
	`version` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `search_passages` (
	`id` integer PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`start_ms` integer NOT NULL,
	`text` text NOT NULL,
	`search_text` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `search_passages_media_order` ON `search_passages` (`media_id`,`start_ms`);--> statement-breakpoint
CREATE VIRTUAL TABLE `media_search` USING fts5(
	`media_id` UNINDEXED,
	`title`,
	`transcript`,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `passage_search` USING fts5(
	`search_text`,
	content = 'search_passages',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `search_passages_insert` AFTER INSERT ON `search_passages` BEGIN
	INSERT INTO `passage_search` (`rowid`, `search_text`) VALUES (new.`id`, new.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_passages_delete` AFTER DELETE ON `search_passages` BEGIN
	INSERT INTO `passage_search` (`passage_search`, `rowid`, `search_text`) VALUES ('delete', old.`id`, old.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_passages_update` AFTER UPDATE ON `search_passages` BEGIN
	INSERT INTO `passage_search` (`passage_search`, `rowid`, `search_text`) VALUES ('delete', old.`id`, old.`search_text`);
	INSERT INTO `passage_search` (`rowid`, `search_text`) VALUES (new.`id`, new.`search_text`);
END;
