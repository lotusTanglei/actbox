CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`conditions` text NOT NULL,
	`actions` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'normal' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rules_account_order` ON `rules` (`account_id`,`order`);--> statement-breakpoint
CREATE INDEX `idx_rules_account_kind` ON `rules` (`account_id`,`kind`);