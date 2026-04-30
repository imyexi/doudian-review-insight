import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router } from "express";
import type { ReviewLevel, Sentiment } from "@shared/types";
import { painPointListQuerySchema } from "@shared/types";
import { db } from "../db/client";
import { painPointEvidence, painPointSpecStats, painPoints, productGroups, reviews } from "../db/schema";
import { loadPainPointForShop } from "../services/painPoints";
import { sendError, sendSuccess } from "../utils/http";
import { serializeProductGroup } from "../utils/productGroups";

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const NOTEWORTHY_SPECIFICITY_THRESHOLD = 4;
const NOTEWORTHY_OCCURRENCE_LIMIT = 5;
const NOTEWORTHY_RESULT_LIMIT = 5;

interface RawEvidenceRow {
  id: number;
  painPointId: number;
  reviewId: number;
  excerpt: string | null;
  specificityScore: number | null;
  createdAt: number;
  review: {
    id: number;
    shopId: number;
    productRefId: number | null;
    productGroupId: number | null;
    uploadId: number | null;
    doudianOrderId: string | null;
    doudianProductId: string;
    productName: string | null;
    productSpec: string | null;
    rating: number | null;
    level: ReviewLevel | null;
    content: string | null;
    appendContent: string | null;
    reviewTime: number;
    appendTime: number | null;
    userNick: string | null;
    merchantReplied: boolean;
    replyContent: string | null;
    createdAt: number;
  };
  reviewProductGroup: {
    id: number | null;
    shopId: number | null;
    name: string | null;
    shortName: string | null;
    createdAt: number | null;
    updatedAt: number | null;
  } | null;
}

function normalizeListQuery(query: Record<string, unknown>): Record<string, unknown> {
  const rawCategory = query.category;
  const rawSentiment = query.sentiment;
  const category = Array.isArray(rawCategory)
    ? rawCategory.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : typeof rawCategory === "string" && rawCategory.trim().length > 0
      ? [rawCategory]
      : undefined;
  const sentiment = Array.isArray(rawSentiment)
    ? rawSentiment.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : typeof rawSentiment === "string" && rawSentiment.trim().length > 0
      ? [rawSentiment]
      : undefined;

  return {
    ...query,
    category,
    sentiment,
  };
}

function getShopIdQueryParam(query: Record<string, unknown>): number {
  return Number(query.shopId);
}

function groupEvidenceRows<T extends { painPointId: number }>(rows: T[]): Map<number, T[]> {
  return rows.reduce((map, row) => {
    const currentRows = map.get(row.painPointId) ?? [];
    if (currentRows.length < 5) {
      map.set(row.painPointId, [...currentRows, row]);
    }
    return map;
  }, new Map<number, T[]>());
}

function serializeEvidenceRow(row: RawEvidenceRow) {
  return {
    ...row,
    review: {
      ...row.review,
      productGroup: serializeProductGroup(row.reviewProductGroup),
    },
  };
}

function normalizeSentimentFilter(value: unknown): Sentiment[] | undefined {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const filtered = values.filter((item): item is Sentiment => item === "positive" || item === "negative" || item === "neutral");
  return filtered.length > 0 ? filtered : undefined;
}

function matchesPainPointSearch(
  q: string | undefined,
  item: {
    canonicalLabel: string;
    description: string | null;
    productGroup: {
      name: string | null;
      shortName: string | null;
    } | null;
  },
  evidenceRows: Array<ReturnType<typeof serializeEvidenceRow>>,
): boolean {
  if (!q) {
    return true;
  }

  const haystacks = [
    item.canonicalLabel,
    item.description,
    item.productGroup?.name,
    item.productGroup?.shortName,
    ...evidenceRows.flatMap(evidence => [
      evidence.excerpt,
      evidence.review?.content,
      evidence.review?.appendContent,
      evidence.review?.productName,
      evidence.review?.productSpec,
    ]),
  ];

  return haystacks.some(value => typeof value === "string" && value.includes(q));
}

async function loadEvidenceForPainPoints(
  shopId: number,
  painPointIds: number[],
): Promise<Map<number, ReturnType<typeof serializeEvidenceRow>[]>> {
  if (painPointIds.length === 0) {
    return new Map<number, ReturnType<typeof serializeEvidenceRow>[]>();
  }

  const rows = await db
    .select({
      id: painPointEvidence.id,
      painPointId: painPointEvidence.painPointId,
      reviewId: painPointEvidence.reviewId,
      excerpt: painPointEvidence.excerpt,
      specificityScore: painPointEvidence.specificityScore,
      createdAt: painPointEvidence.createdAt,
      review: {
        id: reviews.id,
        shopId: reviews.shopId,
        productRefId: reviews.productRefId,
        productGroupId: reviews.productGroupId,
        uploadId: reviews.uploadId,
        doudianOrderId: reviews.doudianOrderId,
        doudianProductId: reviews.doudianProductId,
        productName: reviews.productName,
        productSpec: reviews.productSpec,
        rating: reviews.rating,
        level: reviews.level,
        content: reviews.content,
        appendContent: reviews.appendContent,
        reviewTime: reviews.reviewTime,
        appendTime: reviews.appendTime,
        userNick: reviews.userNick,
        merchantReplied: reviews.merchantReplied,
        replyContent: reviews.replyContent,
        createdAt: reviews.createdAt,
      },
      reviewProductGroup: {
        id: productGroups.id,
        shopId: productGroups.shopId,
        name: productGroups.name,
        shortName: productGroups.shortName,
        createdAt: productGroups.createdAt,
        updatedAt: productGroups.updatedAt,
      },
    })
    .from(painPointEvidence)
    .innerJoin(reviews, eq(reviews.id, painPointEvidence.reviewId))
    .leftJoin(productGroups, eq(productGroups.id, reviews.productGroupId))
    .where(and(eq(reviews.shopId, shopId), inArray(painPointEvidence.painPointId, painPointIds)))
    .orderBy(desc(reviews.reviewTime), desc(painPointEvidence.id));

  const evidenceRows = rows as unknown as RawEvidenceRow[];
  return groupEvidenceRows(evidenceRows.map(serializeEvidenceRow));
}

async function loadRecentOccurrenceCounts(shopId: number, painPointIds: number[]): Promise<Map<number, number>> {
  if (painPointIds.length === 0) {
    return new Map<number, number>();
  }

  const threshold = Math.floor(Date.now() / 1000) - SEVEN_DAYS_IN_SECONDS;
  const rows = await db
    .select({
      painPointId: painPointEvidence.painPointId,
      count: sql<number>`count(*)`,
    })
    .from(painPointEvidence)
    .innerJoin(reviews, eq(reviews.id, painPointEvidence.reviewId))
    .where(
      and(
        eq(reviews.shopId, shopId),
        inArray(painPointEvidence.painPointId, painPointIds),
        gte(reviews.reviewTime, threshold),
      ),
    )
    .groupBy(painPointEvidence.painPointId);

  return rows.reduce((map, row) => new Map(map).set(row.painPointId, row.count), new Map<number, number>());
}

export const painPointsRouter = Router();

function getPainPointOrderBy(sort: "occurrence" | "specificity" | "recent") {
  if (sort === "specificity") {
    return [
      asc(sql`${painPoints.specificityScore} is null`),
      desc(painPoints.specificityScore),
      desc(painPoints.lastSeenAt),
      desc(painPoints.id),
    ] as const;
  }

  if (sort === "recent") {
    return [desc(painPoints.lastSeenAt), desc(painPoints.id)] as const;
  }

  return [desc(painPoints.occurrenceCount), desc(painPoints.lastSeenAt), desc(painPoints.id)] as const;
}

painPointsRouter.get("/", async (request, response) => {
  const parsed = painPointListQuerySchema.safeParse(normalizeListQuery(request.query as Record<string, unknown>));
  if (!parsed.success) {
    sendError(response, "INVALID_QUERY", parsed.error.issues[0]?.message ?? "筛选参数无效", 400);
    return;
  }

  const { category, mode, productGroupId, productRefId, q, sentiment, shopId, sort } = parsed.data;
  const conditions = [eq(painPoints.shopId, shopId), eq(painPoints.status, "active")];

  if (productGroupId) {
    conditions.push(eq(painPoints.productGroupId, productGroupId));
  }

  if (productRefId) {
    conditions.push(eq(painPoints.productRefId, productRefId));
  }

  if (mode === "new7d") {
    conditions.push(eq(painPoints.status, "active"));
  }

  const rows = await db
    .select({
      id: painPoints.id,
      shopId: painPoints.shopId,
      productRefId: painPoints.productRefId,
      productGroupId: painPoints.productGroupId,
      canonicalLabel: painPoints.canonicalLabel,
      category: painPoints.category,
      sentiment: painPoints.sentiment,
      description: painPoints.description,
      firstSeenAt: painPoints.firstSeenAt,
      lastSeenAt: painPoints.lastSeenAt,
      occurrenceCount: painPoints.occurrenceCount,
      specificityScore: painPoints.specificityScore,
      source: painPoints.source,
      status: painPoints.status,
      createdAt: painPoints.createdAt,
      productGroup: {
        id: productGroups.id,
        shopId: productGroups.shopId,
        name: productGroups.name,
        shortName: productGroups.shortName,
        createdAt: productGroups.createdAt,
        updatedAt: productGroups.updatedAt,
      },
    })
    .from(painPoints)
    .leftJoin(productGroups, eq(productGroups.id, painPoints.productGroupId))
    .where(and(...conditions))
    .orderBy(...getPainPointOrderBy(sort));

  const evidenceByPainPoint = await loadEvidenceForPainPoints(shopId, rows.map(item => item.id));
  const recentOccurrenceCounts = await loadRecentOccurrenceCounts(shopId, rows.map(item => item.id));

  const filteredRows = rows.filter(item => {
    if (mode === "new7d" && item.firstSeenAt < Math.floor(Date.now() / 1000) - SEVEN_DAYS_IN_SECONDS) {
      return false;
    }

    if (category && category.length > 0 && !category.includes(item.category as typeof category[number])) {
      return false;
    }

    if (sentiment && sentiment.length > 0 && !sentiment.includes(item.sentiment as typeof sentiment[number])) {
      return false;
    }

    return matchesPainPointSearch(q, item, evidenceByPainPoint.get(item.id) ?? []);
  });

  sendSuccess(
    response,
    filteredRows.map(item => ({
      ...item,
      recent7dOccurrenceCount: recentOccurrenceCounts.get(item.id) ?? 0,
      productGroup: serializeProductGroup(item.productGroup),
      topEvidence: evidenceByPainPoint.get(item.id) ?? [],
    })),
  );
});

painPointsRouter.get("/noteworthy", async (request, response) => {
  const shopId = getShopIdQueryParam(request.query as Record<string, unknown>);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const sentimentFilter = normalizeSentimentFilter(request.query.sentiment);
  const rows = await db
    .select({
      id: painPoints.id,
      shopId: painPoints.shopId,
      productRefId: painPoints.productRefId,
      productGroupId: painPoints.productGroupId,
      canonicalLabel: painPoints.canonicalLabel,
      category: painPoints.category,
      sentiment: painPoints.sentiment,
      description: painPoints.description,
      firstSeenAt: painPoints.firstSeenAt,
      lastSeenAt: painPoints.lastSeenAt,
      occurrenceCount: painPoints.occurrenceCount,
      specificityScore: painPoints.specificityScore,
      source: painPoints.source,
      status: painPoints.status,
      createdAt: painPoints.createdAt,
      productGroup: {
        id: productGroups.id,
        shopId: productGroups.shopId,
        name: productGroups.name,
        shortName: productGroups.shortName,
        createdAt: productGroups.createdAt,
        updatedAt: productGroups.updatedAt,
      },
    })
    .from(painPoints)
    .leftJoin(productGroups, eq(productGroups.id, painPoints.productGroupId))
    .where(
      and(
        eq(painPoints.shopId, shopId),
        eq(painPoints.status, "active"),
        gte(painPoints.specificityScore, NOTEWORTHY_SPECIFICITY_THRESHOLD),
        lte(painPoints.occurrenceCount, NOTEWORTHY_OCCURRENCE_LIMIT),
        ...(sentimentFilter ? [inArray(painPoints.sentiment, sentimentFilter)] : []),
      ),
    )
    .orderBy(desc(painPoints.specificityScore), desc(painPoints.lastSeenAt), desc(painPoints.id))
    .limit(NOTEWORTHY_RESULT_LIMIT);

  const evidenceByPainPoint = await loadEvidenceForPainPoints(shopId, rows.map(item => item.id));
  const recentOccurrenceCounts = await loadRecentOccurrenceCounts(shopId, rows.map(item => item.id));

  sendSuccess(
    response,
    rows.map(item => ({
      ...item,
      recent7dOccurrenceCount: recentOccurrenceCounts.get(item.id) ?? 0,
      productGroup: serializeProductGroup(item.productGroup),
      topEvidence: evidenceByPainPoint.get(item.id) ?? [],
    })),
  );
});

painPointsRouter.get("/:id/evidence", async (request, response) => {
  const painPointId = Number(request.params.id);
  const shopId = getShopIdQueryParam(request.query as Record<string, unknown>);
  if (!Number.isInteger(painPointId) || painPointId <= 0 || !Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "痛点或店铺 ID 无效", 400);
    return;
  }

  const painPoint = await loadPainPointForShop(shopId, painPointId);
  if (!painPoint) {
    sendError(response, "NOT_FOUND", "痛点不存在", 404);
    return;
  }

  const rows = await db
    .select({
      id: painPointEvidence.id,
      painPointId: painPointEvidence.painPointId,
      reviewId: painPointEvidence.reviewId,
      excerpt: painPointEvidence.excerpt,
      specificityScore: painPointEvidence.specificityScore,
      createdAt: painPointEvidence.createdAt,
      review: {
        id: reviews.id,
        shopId: reviews.shopId,
        productRefId: reviews.productRefId,
        productGroupId: reviews.productGroupId,
        uploadId: reviews.uploadId,
        doudianOrderId: reviews.doudianOrderId,
        doudianProductId: reviews.doudianProductId,
        productName: reviews.productName,
        productSpec: reviews.productSpec,
        rating: reviews.rating,
        level: reviews.level,
        content: reviews.content,
        appendContent: reviews.appendContent,
        reviewTime: reviews.reviewTime,
        appendTime: reviews.appendTime,
        userNick: reviews.userNick,
        merchantReplied: reviews.merchantReplied,
        replyContent: reviews.replyContent,
        createdAt: reviews.createdAt,
      },
      reviewProductGroup: {
        id: productGroups.id,
        shopId: productGroups.shopId,
        name: productGroups.name,
        shortName: productGroups.shortName,
        createdAt: productGroups.createdAt,
        updatedAt: productGroups.updatedAt,
      },
    })
    .from(painPointEvidence)
    .innerJoin(reviews, eq(reviews.id, painPointEvidence.reviewId))
    .leftJoin(productGroups, eq(productGroups.id, reviews.productGroupId))
    .where(and(eq(reviews.shopId, shopId), eq(painPointEvidence.painPointId, painPointId)))
    .orderBy(desc(reviews.reviewTime), desc(painPointEvidence.id));

  const evidenceRows = rows as unknown as RawEvidenceRow[];
  sendSuccess(response, evidenceRows.map(serializeEvidenceRow));
});

painPointsRouter.get("/:id/spec-stats", async (request, response) => {
  const painPointId = Number(request.params.id);
  const shopId = getShopIdQueryParam(request.query as Record<string, unknown>);
  if (!Number.isInteger(painPointId) || painPointId <= 0 || !Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "痛点或店铺 ID 无效", 400);
    return;
  }

  const painPoint = await loadPainPointForShop(shopId, painPointId);
  if (!painPoint) {
    sendError(response, "NOT_FOUND", "痛点不存在", 404);
    return;
  }

  const rows = await db
    .select({
      spec: painPointSpecStats.productSpec,
      count: painPointSpecStats.count,
    })
    .from(painPointSpecStats)
    .where(eq(painPointSpecStats.painPointId, painPointId))
    .orderBy(desc(painPointSpecStats.count), painPointSpecStats.productSpec);

  sendSuccess(response, rows);
});

