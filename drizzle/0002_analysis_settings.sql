CREATE TABLE `analysis_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`analysis_mode` text DEFAULT 'hybrid' NOT NULL,
	`openai_base_url` text,
	`openai_api_key` text,
	`openai_model` text,
	`llm_batch_size` integer,
	`llm_max_concurrency` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
