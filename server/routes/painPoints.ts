import { and, desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import type { ReviewLevel } from "@shared/types";
import { painPointListQuerySchema } from "@shared/types";
import { db } from "../db/client";
import { painPointEvidence, painPointSpecStats, painPoints, productGroups, reviews } from "../db/schema";
import { loadPainPointForShop } from "../services/painPoints";
import { sendError, sendSuccess } from "../utils/http";
import { serializeProductGroup } from "../utils/productGroups";

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

interface RawEvidenceRow {
  id: number;
  painPointId: number;
  reviewId: number;
  excerpt: string | null;
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
  const category = Array.isArray(rawCategory)
    ? rawCategory.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : typeof rawCategory === "string" && rawCategory.trim().length > 0
      ? [rawCategory]
      : undefined;

  return {
    ...query,
    category,
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

async function loadEvidenceForPainPoints(painPointIds: number[]): Promise<Map<number, ReturnType<typeof serializeEvidenceRow>[]>> {
  if (painPointIds.length === 0) {
    return new Map<number, ReturnType<typeof serializeEvidenceRow>[]>();
  }

  const rows = await db
    .select({
      id: painPointEvidence.id,
      painPointId: painPointEvidence.painPointId,
      reviewId: painPointEvidence.reviewId,
      excerpt: painPointEvidence.excerpt,
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
    .where(inArray(painPointEvidence.painPointId, painPointIds))
    .orderBy(desc(reviews.reviewTime), desc(painPointEvidence.id));

  const evidenceRows = rows as unknown as RawEvidenceRow[];
  return groupEvidenceRows(evidenceRows.map(serializeEvidenceRow));
}

export const painPointsRouter = Router();

painPointsRouter.get("/", async (request, response) => {
  const parsed = painPointListQuerySchema.safeParse(normalizeListQuery(request.query as Record<string, unknown>));
  if (!parsed.success) {
    sendError(response, "INVALID_QUERY", parsed.error.issues[0]?.message ?? "筛选参数无效", 400);
    return;
  }

  const { category, mode, productGroupId, productRefId, q, shopId } = parsed.data;
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
      description: painPoints.description,
      firstSeenAt: painPoints.firstSeenAt,
      lastSeenAt: painPoints.lastSeenAt,
      occurrenceCount: painPoints.occurrenceCount,
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
    .orderBy(
      mode === "new7d" ? desc(painPoints.firstSeenAt) : desc(painPoints.occurrenceCount),
      desc(painPoints.lastSeenAt),
      desc(painPoints.id),
    );

  const filteredRows = rows.filter(item => {
    if (mode === "new7d" && item.firstSeenAt < Math.floor(Date.now() / 1000) - SEVEN_DAYS_IN_SECONDS) {
      return false;
    }

    if (category && category.length > 0 && !category.includes(item.category as typeof category[number])) {
      return false;
    }

    if (!q) {
      return true;
    }

    return item.canonicalLabel.includes(q) || (item.description ?? "").includes(q);
  });

  const evidenceByPainPoint = await loadEvidenceForPainPoints(filteredRows.map(item => item.id));

  sendSuccess(
    response,
    filteredRows.map(item => ({
      ...item,
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
    .where(eq(painPointEvidence.painPointId, painPointId))
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

