import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { painPointListQuerySchema } from "@shared/types";
import { db } from "../db/client";
import { painPointEvidence, painPointSpecStats, painPoints, reviews } from "../db/schema";
import { sendError, sendSuccess } from "../utils/http";

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

interface EvidenceRow {
  id: number;
  painPointId: number;
  reviewId: number;
  excerpt: string | null;
  createdAt: number;
  review: {
    id: number;
    shopId: number;
    productRefId: number | null;
    uploadId: number | null;
    doudianOrderId: string | null;
    doudianProductId: string;
    productName: string | null;
    productSpec: string | null;
    rating: number | null;
    level: string | null;
    content: string | null;
    appendContent: string | null;
    reviewTime: number;
    appendTime: number | null;
    userNick: string | null;
    merchantReplied: boolean;
    replyContent: string | null;
    createdAt: number;
  };
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

function groupEvidenceRows(rows: EvidenceRow[]): Map<number, EvidenceRow[]> {
  return rows.reduce((map, row) => {
    const currentRows = map.get(row.painPointId) ?? [];
    if (currentRows.length < 5) {
      map.set(row.painPointId, [...currentRows, row]);
    }
    return map;
  }, new Map<number, EvidenceRow[]>());
}

async function loadEvidenceForPainPoints(painPointIds: number[]): Promise<Map<number, EvidenceRow[]>> {
  if (painPointIds.length === 0) {
    return new Map<number, EvidenceRow[]>();
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
    })
    .from(painPointEvidence)
    .innerJoin(reviews, eq(reviews.id, painPointEvidence.reviewId))
    .where(inArray(painPointEvidence.painPointId, painPointIds))
    .orderBy(desc(reviews.reviewTime), desc(painPointEvidence.id));

  return groupEvidenceRows(rows);
}

export const painPointsRouter = Router();

painPointsRouter.get("/", async (request, response) => {
  const parsed = painPointListQuerySchema.safeParse(normalizeListQuery(request.query as Record<string, unknown>));
  if (!parsed.success) {
    sendError(response, "INVALID_QUERY", parsed.error.issues[0]?.message ?? "筛选参数无效", 400);
    return;
  }

  const { category, mode, productRefId, q, shopId } = parsed.data;
  const conditions = [eq(painPoints.shopId, shopId), eq(painPoints.status, "active")];

  if (productRefId) {
    conditions.push(eq(painPoints.productRefId, productRefId));
  }

  if (mode === "new7d") {
    conditions.push(sql`${painPoints.firstSeenAt} >= ${Math.floor(Date.now() / 1000) - SEVEN_DAYS_IN_SECONDS}`);
  }

  if (category && category.length > 0) {
    conditions.push(inArray(painPoints.category, category));
  }

  if (q) {
    conditions.push(
      sql`(${painPoints.canonicalLabel} like ${`%${q}%`} or coalesce(${painPoints.description}, '') like ${`%${q}%`})`,
    );
  }

  const items = await db
    .select()
    .from(painPoints)
    .where(and(...conditions))
    .orderBy(
      mode === "new7d" ? desc(painPoints.firstSeenAt) : desc(painPoints.occurrenceCount),
      desc(painPoints.lastSeenAt),
      desc(painPoints.id),
    );

  const evidenceByPainPoint = await loadEvidenceForPainPoints(items.map(item => item.id));

  sendSuccess(
    response,
    items.map(item => ({
      ...item,
      topEvidence: evidenceByPainPoint.get(item.id) ?? [],
    })),
  );
});

painPointsRouter.get("/:id/evidence", async (request, response) => {
  const painPointId = Number(request.params.id);
  if (!Number.isInteger(painPointId) || painPointId <= 0) {
    sendError(response, "INVALID_ID", "痛点 ID 无效", 400);
    return;
  }

  const [painPoint] = await db.select({ id: painPoints.id }).from(painPoints).where(eq(painPoints.id, painPointId)).limit(1);
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
    })
    .from(painPointEvidence)
    .innerJoin(reviews, eq(reviews.id, painPointEvidence.reviewId))
    .where(eq(painPointEvidence.painPointId, painPointId))
    .orderBy(desc(reviews.reviewTime), desc(painPointEvidence.id));

  sendSuccess(response, rows);
});

painPointsRouter.get("/:id/spec-stats", async (request, response) => {
  const painPointId = Number(request.params.id);
  if (!Number.isInteger(painPointId) || painPointId <= 0) {
    sendError(response, "INVALID_ID", "痛点 ID 无效", 400);
    return;
  }

  const [painPoint] = await db.select({ id: painPoints.id }).from(painPoints).where(eq(painPoints.id, painPointId)).limit(1);
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
