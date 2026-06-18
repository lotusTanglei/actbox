CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`note` text,
	`avatar_path` text,
	`group_id` integer,
	`contact_count` integer DEFAULT 0 NOT NULL,
	`last_contacted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_account_email` ON `contacts` (`account_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_contacts_account_name` ON `contacts` (`account_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_contacts_account_group` ON `contacts` (`account_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `contacts_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_groups_account_name` ON `contacts_groups` (`account_id`,`name`);