CREATE TABLE `pain_point_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pain_point_id` integer NOT NULL,
	`review_id` integer NOT NULL,
	`excerpt` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`pain_point_id`) REFERENCES `pain_points`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pain_point_evidence_unique` ON `pain_point_evidence` (`pain_point_id`,`review_id`);--> statement-breakpoint
CREATE TABLE `pain_point_spec_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pain_point_id` integer NOT NULL,
	`product_spec` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`pain_point_id`) REFERENCES `pain_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pain_point_spec_stats_unique` ON `pain_point_spec_stats` (`pain_point_id`,`product_spec`);--> statement-breakpoint
CREATE TABLE `pain_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`product_ref_id` integer,
	`canonical_label` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`occurrence_count` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_ref_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pain_points_shop_product_label_unique` ON `pain_points` (`shop_id`,`product_ref_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `pain_points_shop_first_seen_idx` ON `pain_points` (`shop_id`,`first_seen_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`doudian_product_id` text NOT NULL,
	`display_name` text,
	`raw_name` text,
	`category` text,
	`notes` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_shop_product_unique` ON `products` (`shop_id`,`doudian_product_id`);--> statement-breakpoint
CREATE INDEX `products_shop_idx` ON `products` (`shop_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`product_ref_id` integer,
	`upload_id` integer,
	`doudian_order_id` text,
	`doudian_product_id` text NOT NULL,
	`product_name` text,
	`product_spec` text,
	`rating` integer,
	`level` text,
	`content` text,
	`append_content` text,
	`review_time` integer NOT NULL,
	`append_time` integer,
	`user_nick` text,
	`merchant_replied` integer DEFAULT false NOT NULL,
	`reply_content` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_ref_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_shop_order_product_unique` ON `reviews` (`shop_id`,`doudian_order_id`,`doudian_product_id`);--> statement-breakpoint
CREATE INDEX `reviews_shop_review_time_idx` ON `reviews` (`shop_id`,`review_time`);--> statement-breakpoint
CREATE INDEX `reviews_product_review_time_idx` ON `reviews` (`product_ref_id`,`review_time`);--> statement-breakpoint
CREATE TABLE `shops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`doudian_shop_id` text,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_name_unique` ON `shops` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `shops_doudian_shop_id_unique` ON `shops` (`doudian_shop_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`original_filename` text NOT NULL,
	`stored_path` text NOT NULL,
	`row_count` integer,
	`status` text NOT NULL,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uploads_shop_idx` ON `uploads` (`shop_id`);