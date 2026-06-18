CREATE TABLE `labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`color` text DEFAULT '#6b7280' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_labels_account_name` ON `labels` (`account_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_labels_account_parent` ON `labels` (`account_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `message_labels` (
	`message_id` integer NOT NULL,
	`label_id` integer NOT NULL,
	PRIMARY KEY(`message_id`, `label_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_message_labels_label` ON `message_labels` (`label_id`);