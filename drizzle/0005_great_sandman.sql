ALTER TABLE `analysis_settings` ADD `llm_product_name_enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `pain_points` ADD `sentiment` text DEFAULT 'negative' NOT NULL;
--> statement-breakpoint
ALTER TABLE `pain_points` ADD `specificity_score` integer;
--> statement-breakpoint
ALTER TABLE `pain_point_evidence` ADD `specificity_score` integer;
--> statement-breakpoint
ALTER TABLE `products` ADD `llm_extracted_name` text;
