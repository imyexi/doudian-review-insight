import { z } from "zod";

export const painPointCategorySchema = z.enum([
  "质量",
  "物流",
  "款式外观",
  "客服",
  "价格",
  "使用体验",
  "其他",
]);

export const uploadStatusSchema = z.enum([
  "queued",
  "parsing",
  "analyzing",
  "done",
  "failed",
]);

export const painPointSourceSchema = z.enum(["rule", "llm", "merged"]);
export const painPointModeSchema = z.enum(["historical", "new7d"]);
export const painPointSortSchema = z.enum(["occurrence", "specificity", "recent"]);
export const painPointStatusSchema = z.enum(["active", "archived"]);
export const analysisModeSchema = z.enum(["rules_only", "llm_only", "hybrid"]);
export const sentimentSchema = z.enum(["positive", "negative", "neutral"]);
export const productClassificationSourceSchema = z.enum(["auto", "manual"]);
export const reviewLevelSchema = z.enum(["好评", "中评", "差评"]);

export const shopSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  doudianShopId: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
});

export const shopInputSchema = z.object({
  name: z.string().trim().min(1, "请输入店铺名称").max(120),
  doudianShopId: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const productGroupSchema = z.object({
  id: z.number().int().positive(),
  shopId: z.number().int().positive(),
  name: z.string().min(1),
  shortName: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const productSchema = z.object({
  id: z.number().int().positive(),
  shopId: z.number().int().positive(),
  productGroupId: z.number().int().positive().nullable(),
  doudianProductId: z.string().min(1),
  displayName: z.string().nullable(),
  rawName: z.string().nullable(),
  shortName: z.string().nullable(),
  llmExtractedName: z.string().nullable(),
  category: z.string().nullable(),
  notes: z.string().nullable(),
  classificationSource: productClassificationSourceSchema,
  classificationLocked: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  latestReviewTime: z.number().int().nonnegative().nullable(),
  painPointCount: z.number().int().nonnegative(),
  productGroup: productGroupSchema.nullable().optional(),
});

export const productInputSchema = z.object({
  doudianProductId: z.string().trim().min(1, "请输入商品 ID").max(120),
  displayName: z.string().trim().max(120).optional().or(z.literal("")),
  rawName: z.string().trim().max(500).optional().or(z.literal("")),
  shortName: z.string().trim().max(120).optional().or(z.literal("")),
  category: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  enabled: z.boolean().optional(),
});

export const productRegroupSchema = z.object({
  productGroupId: z.number().int().positive(),
});

export const uploadSchema = z.object({
  id: z.number().int().positive(),
  shopId: z.number().int().positive(),
  originalFilename: z.string().min(1),
  storedPath: z.string().min(1),
  fileHash: z.string().nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  rowCount: z.number().int().nonnegative().nullable(),
  status: uploadStatusSchema,
  progressCurrent: z.number().int().nonnegative(),
  progressTotal: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().nullable(),
});

export const reviewSchema = z.object({
  id: z.number().int().positive(),
  shopId: z.number().int().positive(),
  productRefId: z.number().int().positive().nullable(),
  productGroupId: z.number().int().positive().nullable(),
  uploadId: z.number().int().positive().nullable(),
  doudianOrderId: z.string().nullable(),
  doudianProductId: z.string().min(1),
  productName: z.string().nullable(),
  productSpec: z.string().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  level: reviewLevelSchema.nullable(),
  content: z.string().nullable(),
  appendContent: z.string().nullable(),
  reviewTime: z.number().int().nonnegative(),
  appendTime: z.number().int().nonnegative().nullable(),
  userNick: z.string().nullable(),
  merchantReplied: z.boolean(),
  replyContent: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  productGroup: productGroupSchema.nullable().optional(),
});

export const painPointEvidenceSchema = z.object({
  id: z.number().int().positive(),
  painPointId: z.number().int().positive(),
  reviewId: z.number().int().positive(),
  excerpt: z.string().nullable(),
  specificityScore: z.number().int().min(1).max(5).nullable(),
  createdAt: z.number().int().nonnegative(),
  review: reviewSchema.optional(),
});

export const painPointSchema = z.object({
  id: z.number().int().positive(),
  shopId: z.number().int().positive(),
  productRefId: z.number().int().positive().nullable(),
  productGroupId: z.number().int().positive().nullable(),
  canonicalLabel: z.string().min(1),
  category: painPointCategorySchema,
  sentiment: sentimentSchema,
  description: z.string().nullable(),
  firstSeenAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  occurrenceCount: z.number().int().nonnegative(),
  recent7dOccurrenceCount: z.number().int().nonnegative(),
  specificityScore: z.number().int().min(1).max(5).nullable(),
  source: painPointSourceSchema,
  status: painPointStatusSchema,
  createdAt: z.number().int().nonnegative(),
  productGroup: productGroupSchema.nullable().optional(),
  topEvidence: z.array(painPointEvidenceSchema).optional(),
});

export const specStatSchema = z.object({
  spec: z.string(),
  count: z.number().int().nonnegative(),
});

export const reviewListQuerySchema = z.object({
  shopId: z.coerce.number().int().positive(),
  productRefId: z.coerce.number().int().positive().optional(),
  productGroupId: z.coerce.number().int().positive().optional(),
  painPointId: z.coerce.number().int().positive().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  spec: z.string().trim().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const painPointListQuerySchema = z.object({
  shopId: z.coerce.number().int().positive(),
  productRefId: z.coerce.number().int().positive().optional(),
  productGroupId: z.coerce.number().int().positive().optional(),
  mode: painPointModeSchema.default("historical"),
  sort: painPointSortSchema.default("occurrence"),
  category: z.array(painPointCategorySchema).optional(),
  sentiment: z.array(sentimentSchema).optional(),
  q: z.string().trim().optional(),
});

export const uploadCreateSchema = z.object({
  shopId: z.coerce.number().int().positive(),
});

export const analysisSettingsSchema = z.object({
  analysisMode: analysisModeSchema,
  openaiBaseUrl: z.string().min(1),
  openaiModel: z.string().min(1),
  llmBatchSize: z.number().int().min(1).max(100),
  llmMaxConcurrency: z.number().int().min(1).max(10),
  llmProductNameEnabled: z.boolean(),
  hasApiKey: z.boolean(),
  maskedApiKey: z.string().nullable(),
  updatedAt: z.number().int().nonnegative(),
});

export const analysisSettingsUpdateSchema = z.object({
  analysisMode: analysisModeSchema,
  openaiBaseUrl: z.string().trim().max(500),
  openaiModel: z.string().trim().max(200),
  openaiApiKey: z.string().trim().max(500).optional(),
  llmBatchSize: z.coerce.number().int().min(1).max(100),
  llmMaxConcurrency: z.coerce.number().int().min(1).max(10),
  llmProductNameEnabled: z.boolean(),
}).superRefine((value, context) => {
  if (value.analysisMode === "rules_only") {
    return;
  }

  if (!value.openaiBaseUrl) {
    context.addIssue({
      code: "custom",
      path: ["openaiBaseUrl"],
      message: "请输入 API Base URL",
    });
  }

  if (!value.openaiModel) {
    context.addIssue({
      code: "custom",
      path: ["openaiModel"],
      message: "请输入模型名称",
    });
  }
});


export const topPainPointOverviewSchema = z.object({
  canonicalLabel: z.string().min(1),
  category: painPointCategorySchema,
  sentiment: sentimentSchema,
  occurrenceCount: z.number().int().nonnegative(),
  specificityScore: z.number().int().min(1).max(5).nullable(),
  lastSeenAt: z.number().int().nonnegative(),
  relatedProducts: z.array(z.string()),
  extraProductCount: z.number().int().nonnegative(),
});

export const overviewStatsSchema = z.object({
  totalReviews: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  avgRating: z.number().nonnegative(),
  painPoints: z.object({
    historical: z.number().int().nonnegative(),
    new7d: z.number().int().nonnegative(),
  }),
  trend30d: z.array(
    z.object({
      date: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  topPainPoints: z.array(topPainPointOverviewSchema),
});

export const authLoginSchema = z.object({
  password: z.string().min(1, "请输入密码"),
});

export type PainPointCategory = z.infer<typeof painPointCategorySchema>;
export type UploadStatus = z.infer<typeof uploadStatusSchema>;
export type PainPointSource = z.infer<typeof painPointSourceSchema>;
export type PainPointMode = z.infer<typeof painPointModeSchema>;
export type PainPointSort = z.infer<typeof painPointSortSchema>;
export type PainPointStatus = z.infer<typeof painPointStatusSchema>;
export type AnalysisMode = z.infer<typeof analysisModeSchema>;
export type Sentiment = z.infer<typeof sentimentSchema>;
export type ProductClassificationSource = z.infer<typeof productClassificationSourceSchema>;
export type ReviewLevel = z.infer<typeof reviewLevelSchema>;
export type Shop = z.infer<typeof shopSchema>;
export type ShopInput = z.infer<typeof shopInputSchema>;
export type ProductGroup = z.infer<typeof productGroupSchema>;
export type Product = z.infer<typeof productSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type Upload = z.infer<typeof uploadSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type PainPointEvidence = z.infer<typeof painPointEvidenceSchema>;
export type PainPoint = z.infer<typeof painPointSchema>;
export type SpecStat = z.infer<typeof specStatSchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
export type PainPointListQuery = z.infer<typeof painPointListQuerySchema>;
export type TopPainPointOverview = z.infer<typeof topPainPointOverviewSchema>;
export type OverviewStats = z.infer<typeof overviewStatsSchema>;
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;
export type AnalysisSettingsUpdate = z.infer<typeof analysisSettingsUpdateSchema>;
export type ProductRegroupInput = z.infer<typeof productRegroupSchema>;
export type AuthLoginInput = z.infer<typeof authLoginSchema>;

export interface ApiErrorShape {
  code: string;
  message: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorShape;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ReviewListResponse {
  items: Review[];
  total: number;
  page: number;
  pageSize: number;
}
