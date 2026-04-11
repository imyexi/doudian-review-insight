ALTER TABLE `uploads` ADD `file_hash` text;--> statement-breakpoint
ALTER TABLE `uploads` ADD `file_size` integer;--> statement-breakpoint
CREATE INDEX `uploads_shop_file_hash_idx` ON `uploads` (`shop_id`,`file_hash`);