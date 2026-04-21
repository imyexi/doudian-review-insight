import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const shops = sqliteTable("shops", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  doudianShopId: text("doudian_shop_id"),
  description: text("description"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, table => ({
  nameUnique: uniqueIndex("shops_name_unique").on(table.name),
  doudianShopIdUnique: uniqueIndex("shops_doudian_shop_id_unique").on(table.doudianShopId),
}));

export const productGroups = sqliteTable("product_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopId: integer("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, table => ({
  shopNameUnique: uniqueIndex("product_groups_shop_name_unique").on(table.shopId, table.name),
  shopShortNameUnique: uniqueIndex("product_groups_shop_short_name_unique").on(table.shopId, table.shortName),
  shopIdx: index("product_groups_shop_idx").on(table.shopId),
}));

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopId: integer("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  productGroupId: integer("product_group_id").references(() => productGroups.id, { onDelete: "set null" }),
  doudianProductId: text("doudian_product_id").notNull(),
  displayName: text("display_name"),
  rawName: text("raw_name"),
  shortName: text("short_name"),
  category: text("category"),
  notes: text("notes"),
  classificationSource: text("classification_source").notNull().default("auto"),
  classificationLocked: integer("classification_locked", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, table => ({
  shopProductUnique: uniqueIndex("products_shop_product_unique").on(table.shopId, table.doudianProductId),
  shopIdx: index("products_shop_idx").on(table.shopId),
  groupIdx: index("products_group_idx").on(table.productGroupId),
}));

export const uploads = sqliteTable("uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopId: integer("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  originalFilename: text("original_filename").notNull(),
  storedPath: text("stored_path").notNull(),
  fileHash: text("file_hash"),
  fileSize: integer("file_size"),
  rowCount: integer("row_count"),
  status: text("status").notNull(),
  progressCurrent: integer("progress_current").notNull().default(0),
  progressTotal: integer("progress_total").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  finishedAt: integer("finished_at"),
}, table => ({
  shopIdx: index("uploads_shop_idx").on(table.shopId),
  shopFileHashIdx: index("uploads_shop_file_hash_idx").on(table.shopId, table.fileHash),
}));

export const analysisSettings = sqliteTable("analysis_settings", {
  id: integer("id").primaryKey().default(1),
  analysisMode: text("analysis_mode").notNull().default("hybrid"),
  openaiBaseUrl: text("openai_base_url"),
  openaiApiKey: text("openai_api_key"),
  openaiModel: text("openai_model"),
  llmBatchSize: integer("llm_batch_size"),
  llmMaxConcurrency: integer("llm_max_concurrency"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopId: integer("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  productRefId: integer("product_ref_id").references(() => products.id, { onDelete: "set null" }),
  productGroupId: integer("product_group_id").references(() => productGroups.id, { onDelete: "set null" }),
  uploadId: integer("upload_id").references(() => uploads.id, { onDelete: "cascade" }),
  doudianOrderId: text("doudian_order_id"),
  doudianProductId: text("doudian_product_id").notNull(),
  productName: text("product_name"),
  productSpec: text("product_spec"),
  rating: integer("rating"),
  level: text("level"),
  content: text("content"),
  appendContent: text("append_content"),
  reviewTime: integer("review_time").notNull(),
  appendTime: integer("append_time"),
  userNick: text("user_nick"),
  merchantReplied: integer("merchant_replied", { mode: "boolean" }).notNull().default(false),
  replyContent: text("reply_content"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, table => ({
  dedupeUnique: uniqueIndex("reviews_shop_order_product_unique").on(table.shopId, table.doudianOrderId, table.doudianProductId),
  shopTimeIdx: index("reviews_shop_review_time_idx").on(table.shopId, table.reviewTime),
  productTimeIdx: index("reviews_product_review_time_idx").on(table.productRefId, table.reviewTime),
  groupTimeIdx: index("reviews_group_review_time_idx").on(table.productGroupId, table.reviewTime),
}));

export const painPoints = sqliteTable("pain_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopId: integer("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  productRefId: integer("product_ref_id").references(() => products.id, { onDelete: "set null" }),
  productGroupId: integer("product_group_id").references(() => productGroups.id, { onDelete: "set null" }),
  canonicalLabel: text("canonical_label").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  occurrenceCount: integer("occurrence_count").notNull().default(0),
  source: text("source").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, table => ({
  painPointUnique: uniqueIndex("pain_points_shop_group_label_unique").on(table.shopId, table.productGroupId, table.canonicalLabel),
  shopFirstSeenIdx: index("pain_points_shop_first_seen_idx").on(table.shopId, table.firstSeenAt),
  groupFirstSeenIdx: index("pain_points_group_first_seen_idx").on(table.productGroupId, table.firstSeenAt),
}));

export const painPointEvidence = sqliteTable("pain_point_evidence", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  painPointId: integer("pain_point_id").notNull().references(() => painPoints.id, { onDelete: "cascade" }),
  reviewId: integer("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  excerpt: text("excerpt"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, table => ({
  relationUnique: uniqueIndex("pain_point_evidence_unique").on(table.painPointId, table.reviewId),
}));

export const painPointSpecStats = sqliteTable("pain_point_spec_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  painPointId: integer("pain_point_id").notNull().references(() => painPoints.id, { onDelete: "cascade" }),
  productSpec: text("product_spec").notNull(),
  count: integer("count").notNull().default(0),
}, table => ({
  statUnique: uniqueIndex("pain_point_spec_stats_unique").on(table.painPointId, table.productSpec),
}));

export type ShopRow = typeof shops.$inferSelect;
export type ShopInsert = typeof shops.$inferInsert;
export type ProductGroupRow = typeof productGroups.$inferSelect;
export type ProductGroupInsert = typeof productGroups.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
export type UploadRow = typeof uploads.$inferSelect;
export type UploadInsert = typeof uploads.$inferInsert;
export type ReviewRow = typeof reviews.$inferSelect;
export type ReviewInsert = typeof reviews.$inferInsert;
export type AnalysisSettingsRow = typeof analysisSettings.$inferSelect;
export type AnalysisSettingsInsert = typeof analysisSettings.$inferInsert;
export type PainPointRow = typeof painPoints.$inferSelect;
export type PainPointInsert = typeof painPoints.$inferInsert;
