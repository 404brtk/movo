CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`original_name` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`duration_seconds` real NOT NULL,
	`imported_at` integer NOT NULL,
	CONSTRAINT "media_positive_size" CHECK("media_items"."byte_size" > 0),
	CONSTRAINT "media_positive_duration" CHECK("media_items"."duration_seconds" > 0)
);
