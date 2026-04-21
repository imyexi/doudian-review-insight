CREATE TABLE `__new_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`product_ref_id` integer,
	`product_group_id` integer,
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
	FOREIGN KEY (`product_group_id`) REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reviews` (`id`, `shop_id`, `product_ref_id`, `product_group_id`, `upload_id`, `doudian_order_id`, `doudian_product_id`, `product_name`, `product_spec`, `rating`, `level`, `content`, `append_content`, `review_time`, `append_time`, `user_nick`, `merchant_replied`, `reply_content`, `created_at`)
SELECT `id`, `shop_id`, `product_ref_id`, `product_group_id`, `upload_id`, `doudian_order_id`, `doudian_product_id`, `product_name`, `product_spec`, `rating`, `level`, `content`, `append_content`, `review_time`, `append_time`, `user_nick`, `merchant_replied`, `reply_content`, `created_at`
FROM `reviews`;
--> statement-breakpoint
DROP TABLE `reviews`;
--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_shop_order_product_unique` ON `reviews` (`shop_id`,`doudian_order_id`,`doudian_product_id`);
--> statement-breakpoint
CREATE INDEX `reviews_shop_review_time_idx` ON `reviews` (`shop_id`,`review_time`);
--> statement-breakpoint
CREATE INDEX `reviews_product_review_time_idx` ON `reviews` (`product_ref_id`,`review_time`);
--> statement-breakpoint
CREATE INDEX `reviews_group_review_time_idx` ON `reviews` (`product_group_id`,`review_time`);
