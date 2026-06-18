CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text,
	`size` integer NOT NULL,
	`content_id` text,
	`is_inline` integer DEFAULT false NOT NULL,
	`storage_path` text,
	`sha256` text,
	`scan_status` text DEFAULT 'ok' NOT NULL,
	`scan_reason` text,
	`over_size_limit` integer DEFAULT false NOT NULL,
	`downloaded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_message` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_sha` ON `attachments` (`sha256`);