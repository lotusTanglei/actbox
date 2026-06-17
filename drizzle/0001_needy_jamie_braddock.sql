ALTER TABLE `messages` ADD `to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `cc` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `bcc` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `account_id` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `folder` text DEFAULT 'INBOX' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `imap_uid` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `imap_seq` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `thread_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `snoozed_until` integer;--> statement-breakpoint
CREATE INDEX `idx_messages_account_folder_uid` ON `messages` (`account_id`,`folder`,`imap_uid`);--> statement-breakpoint
CREATE INDEX `idx_messages_thread` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_account_received` ON `messages` (`account_id`,`received_at`);