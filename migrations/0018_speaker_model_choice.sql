CREATE TABLE `model_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`speaker_model_id` text,
	CONSTRAINT "model_settings_single_row" CHECK("model_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `transcription_jobs` ADD `speaker_model_id` text;