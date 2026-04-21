CREATE TABLE `product_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_groups_shop_name_unique` ON `product_groups` (`shop_id`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_groups_shop_short_name_unique` ON `product_groups` (`shop_id`,`short_name`);
--> statement-breakpoint
CREATE INDEX `product_groups_shop_idx` ON `product_groups` (`shop_id`);
--> statement-breakpoint
ALTER TABLE `products` ADD `product_group_id` integer REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `products` ADD `short_name` text;
--> statement-breakpoint
ALTER TABLE `products` ADD `classification_source` text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD `classification_locked` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX `products_group_idx` ON `products` (`product_group_id`);
--> statement-breakpoint
ALTER TABLE `reviews` ADD `product_group_id` integer REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `reviews_group_review_time_idx` ON `reviews` (`product_group_id`,`review_time`);
--> statement-breakpoint
ALTER TABLE `pain_points` ADD `product_group_id` integer REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `pain_points_group_first_seen_idx` ON `pain_points` (`product_group_id`,`first_seen_at`);
--> statement-breakpoint
CREATE TABLE `__new_pain_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`product_ref_id` integer,
	`product_group_id` integer,
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
	FOREIGN KEY (`product_ref_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_group_id`) REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_pain_points` (`id`, `shop_id`, `product_ref_id`, `product_group_id`, `canonical_label`, `category`, `description`, `first_seen_at`, `last_seen_at`, `occurrence_count`, `source`, `status`, `created_at`)
SELECT `id`, `shop_id`, `product_ref_id`, `product_group_id`, `canonical_label`, `category`, `description`, `first_seen_at`, `last_seen_at`, `occurrence_count`, `source`, `status`, `created_at`
FROM `pain_points`;
--> statement-breakpoint
DROP TABLE `pain_points`;
--> statement-breakpoint
ALTER TABLE `__new_pain_points` RENAME TO `pain_points`;
--> statement-breakpoint
CREATE UNIQUE INDEX `pain_points_shop_group_label_unique` ON `pain_points` (`shop_id`,`product_group_id`,`canonical_label`);
--> statement-breakpoint
CREATE INDEX `pain_points_shop_first_seen_idx` ON `pain_points` (`shop_id`,`first_seen_at`);
--> statement-breakpoint
CREATE INDEX `pain_points_group_first_seen_idx` ON `pain_points` (`product_group_id`,`first_seen_at`);
--> statement-breakpoint
UPDATE `products`
SET `short_name` = lower(replace(coalesce(`raw_name`, `display_name`, `doudian_product_id`), ' ', '')),
    `updated_at` = coalesce(`updated_at`, unixepoch());
--> statement-breakpoint
INSERT INTO `product_groups` (`shop_id`, `name`, `short_name`, `created_at`, `updated_at`)
SELECT `shop_id`,
       coalesce(nullif(`short_name`, ''), `doudian_product_id`),
       coalesce(nullif(`short_name`, ''), `doudian_product_id`),
       `created_at`,
       `updated_at`
FROM `products`
WHERE coalesce(nullif(`short_name`, ''), `doudian_product_id`) != ''
GROUP BY `shop_id`, coalesce(nullif(`short_name`, ''), `doudian_product_id`);
--> statement-breakpoint
UPDATE `products`
SET `product_group_id` = (
  SELECT `product_groups`.`id`
  FROM `product_groups`
  WHERE `product_groups`.`shop_id` = `products`.`shop_id`
    AND `product_groups`.`short_name` = coalesce(nullif(`products`.`short_name`, ''), `products`.`doudian_product_id`)
  LIMIT 1
);
--> statement-breakpoint
UPDATE `reviews`
SET `product_group_id` = (
  SELECT `products`.`product_group_id`
  FROM `products`
  WHERE `products`.`id` = `reviews`.`product_ref_id`
  LIMIT 1
);
--> statement-breakpoint
UPDATE `pain_points`
SET `product_group_id` = (
  SELECT `products`.`product_group_id`
  FROM `products`
  WHERE `products`.`id` = `pain_points`.`product_ref_id`
  LIMIT 1
);
