CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`provider` text NOT NULL,
	`protocol` text DEFAULT 'imap' NOT NULL,
	`imap_host` text,
	`imap_port` integer,
	`smtp_host` text,
	`smtp_port` integer,
	`user` text NOT NULL,
	`auth_code` text NOT NULL,
	`oauth_refresh_token` text,
	`display_name` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sync_mode` text DEFAULT 'idle' NOT NULL,
	`last_synced_at` integer,
	`sync_status` text DEFAULT 'healthy' NOT NULL,
	`sync_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE INDEX `idx_accounts_active` ON `accounts` (`is_active`);