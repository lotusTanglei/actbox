CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`subject` text,
	`sender` text,
	`recipient` text,
	`body` text,
	`body_html` text,
	`received_at` integer,
	`processed_at` integer NOT NULL,
	`direction` text DEFAULT 'in' NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`todo_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_message_id_unique` ON `messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`priority` text,
	`context` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_message_id` text,
	`source_subject` text,
	`source_from` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
