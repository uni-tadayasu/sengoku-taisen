CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `name_key` text NOT NULL UNIQUE,
  `clan` text NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `created_at` integer NOT NULL,
  `last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_last_seen_idx` ON `users` (`last_seen`);
--> statement-breakpoint
CREATE TABLE `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guilds` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `name_key` text NOT NULL UNIQUE,
  `owner_id` text NOT NULL REFERENCES `users` (`id`),
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guild_members` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `guild_id` text NOT NULL REFERENCES `guilds` (`id`) ON DELETE CASCADE,
  `joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `guild_members_guild_idx` ON `guild_members` (`guild_id`, `joined_at`, `user_id`);
--> statement-breakpoint
CREATE TABLE `friendships` (
  `user_a` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `user_b` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `requested_by` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `status` text NOT NULL CHECK (`status` IN ('pending', 'accepted')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`user_a`, `user_b`),
  CHECK (`user_a` < `user_b`),
  CHECK (`requested_by` = `user_a` OR `requested_by` = `user_b`)
);
--> statement-breakpoint
CREATE INDEX `friendships_user_b_idx` ON `friendships` (`user_b`, `status`);
--> statement-breakpoint
CREATE TABLE `messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `room_key` text NOT NULL,
  `channel` text NOT NULL CHECK (`channel` IN ('world', 'guild', 'friend', 'admin')),
  `user_id` text NOT NULL REFERENCES `users` (`id`),
  `body` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_room_id_idx` ON `messages` (`room_key`, `id`);
--> statement-breakpoint
CREATE TABLE `mail_campaigns` (
  `id` text PRIMARY KEY NOT NULL,
  `sender_id` text NOT NULL REFERENCES `users` (`id`),
  `target_user_id` text REFERENCES `users` (`id`),
  `title` text NOT NULL,
  `body` text NOT NULL,
  `gift_json` text,
  `request_id` text NOT NULL,
  `payload_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  UNIQUE (`sender_id`, `request_id`)
);
--> statement-breakpoint
CREATE INDEX `mail_campaigns_target_created_idx` ON `mail_campaigns` (`target_user_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `mail_reads` (
  `mail_id` text NOT NULL REFERENCES `mail_campaigns` (`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `read_at` integer NOT NULL,
  PRIMARY KEY (`mail_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_receipts` (
  `mail_id` text NOT NULL REFERENCES `mail_campaigns` (`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `receipt_id` text NOT NULL UNIQUE,
  `request_id` text NOT NULL,
  `gift_json` text NOT NULL,
  `claimed_at` integer NOT NULL,
  PRIMARY KEY (`mail_id`, `user_id`),
  UNIQUE (`user_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
  `scope` text PRIMARY KEY NOT NULL,
  `window_start` integer NOT NULL,
  `count` integer NOT NULL,
  `last_at` integer NOT NULL
);
