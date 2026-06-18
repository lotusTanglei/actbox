ALTER TABLE `messages` ADD `is_spam` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `auth_result` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_external` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `spam_reasons` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `spam_score` real DEFAULT 0 NOT NULL;