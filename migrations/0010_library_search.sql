CREATE VIRTUAL TABLE `media_search` USING fts5(
	`media_id` UNINDEXED,
	`title`,
	`transcript`,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
WITH RECURSIVE `source` AS (
	SELECT
		`media_items`.`id` AS `media_id`,
		`media_items`.`title` AS `title`,
		coalesce(
			(
				SELECT group_concat(`word`.`value` ->> 'text', ' ' ORDER BY `word`.`key`)
				FROM json_each(`transcription_jobs`.`transcript`, '$.words') AS `word`
			),
			''
		) AS `transcript`
	FROM `media_items`
	LEFT JOIN `transcription_jobs` ON `transcription_jobs`.`media_id` = `media_items`.`id`
),
`letters` (`text`, `plain`) AS (
	VALUES ('ł', 'l'), ('Ł', 'l'), ('đ', 'd'), ('Đ', 'd'), ('ø', 'o'), ('Ø', 'o'),
		('ħ', 'h'), ('Ħ', 'h'), ('ŧ', 't'), ('Ŧ', 't'), ('ı', 'i')
),
`folded` (`media_id`, `title`, `transcript`, `step`) AS (
	SELECT `media_id`, `title`, `transcript`, 0 FROM `source`
	UNION ALL
	SELECT
		`folded`.`media_id`,
		replace(`folded`.`title`, `letter`.`text`, `letter`.`plain`),
		replace(`folded`.`transcript`, `letter`.`text`, `letter`.`plain`),
		`folded`.`step` + 1
	FROM `folded`
	JOIN (SELECT `text`, `plain`, row_number() OVER () AS `step` FROM `letters`) AS `letter`
		ON `letter`.`step` = `folded`.`step` + 1
)
INSERT INTO `media_search` (`media_id`, `title`, `transcript`)
SELECT `media_id`, `title`, `transcript`
FROM `folded`
WHERE `step` = (SELECT count(*) FROM `letters`);
