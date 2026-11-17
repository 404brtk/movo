CREATE TABLE `dictionary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`spelling` text NOT NULL,
	`similar` integer NOT NULL,
	`also_replace` text NOT NULL,
	`never_change` text NOT NULL,
	`fixes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
