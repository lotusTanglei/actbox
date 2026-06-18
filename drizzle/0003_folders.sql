CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`path` text NOT NULL,
	`display_name` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_folders_account_path` ON `folders` (`account_id`,`path`);