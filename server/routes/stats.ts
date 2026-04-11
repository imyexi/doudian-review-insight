import { and, eq, gte, sql } from "drizzle-orm";
import { Router } from "express";
import type { PainPointCategory, TopPainPointOverview } from "@shared/types";
import { db } from "../db/client";
import { painPoints, products, reviews } from "../db/schema";
import { sendError, sendSuccess } from "../utils/http";

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
const TOP_PAIN_POINT_LIMIT = 10;
const RELATED_PRODUCT_PREVIEW_LIMIT = 3;
const STORE_LEVEL_PRODUCT_LABEL = "店铺级";

interface TrendRow {
  date: string;
  count: number;
}

interface TopPainPointRow {
  canonicalLabel: string;
  category: PainPointCategory;
  occurrenceCount: number;
  lastSeenAt: number;
  productLabel: string | null;
}

interface TopPainPointAccumulator extends TopPainPointOverview {
  allProducts: string[];
}

function createTrendWindow(): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: 30 }, (_value, index) => {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() - (29 - index));
    return nextDate.toISOString().slice(0, 10);
  });
}

function normalizeTrendRows(rows: TrendRow[]): TrendRow[] {
  const countsByDate = rows.reduce((map, row) => {
    return {
      ...map,
      [row.date]: row.count,
    };
  }, {} as Record<string, number>);

  return createTrendWindow().map(date => ({
    date,
    count: countsByDate[date] ?? 0,
  }));
}

function getProductLabel(row: TopPainPointRow): string {
  return row.productLabel ?? STORE_LEVEL_PRODUCT_LABEL;
}

function normalizeTopPainPoints(rows: TopPainPointRow[]): TopPainPointOverview[] {
  const aggregated = rows.reduce<Record<string, TopPainPointAccumulator>>((current, row) => {
    const key = `${row.category}::${row.canonicalLabel}`;
    const existing = current[key];
    const productLabel = getProductLabel(row);
    const nextProducts = existing
      ? existing.allProducts.includes(productLabel)
        ? existing.allProducts
        : [...existing.allProducts, productLabel]
      : [productLabel];

    return {
      ...current,
      [key]: {
        canonicalLabel: row.canonicalLabel,
        category: row.category,
        occurrenceCount: (existing?.occurrenceCount ?? 0) + row.occurrenceCount,
        lastSeenAt: Math.max(existing?.lastSeenAt ?? 0, row.lastSeenAt),
        relatedProducts: nextProducts.slice(0, RELATED_PRODUCT_PREVIEW_LIMIT),
        extraProductCount: Math.max(nextProducts.length - RELATED_PRODUCT_PREVIEW_LIMIT, 0),
        allProducts: nextProducts,
      },
    };
  }, {});

  return Object.values(aggregated)
    .map(({ allProducts, ...item }) => item)
    .sort((left, right) => {
      if (right.occurrenceCount !== left.occurrenceCount) {
        return right.occurrenceCount - left.occurrenceCount;
      }

      return right.lastSeenAt - left.lastSeenAt;
    })
    .slice(0, TOP_PAIN_POINT_LIMIT);
}

export const statsRouter = Router();

statsRouter.get("/overview", async (request, response) => {
  const shopId = Number(request.query.shopId);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const newPainPointThreshold = now - SEVEN_DAYS_IN_SECONDS;
  const trendThreshold = now - THIRTY_DAYS_IN_SECONDS;

  const [[reviewSummary], [painPointSummary], trendRows, topPainPointRows] = await Promise.all([
    db
      .select({
        totalReviews: sql<number>`count(*)`,
        negativeCount: sql<number>`sum(case when ${reviews.rating} is not null and ${reviews.rating} <= 3 then 1 else 0 end)`,
        avgRating: sql<number>`coalesce(round(avg(${reviews.rating}), 2), 0)`,
      })
      .from(reviews)
      .where(eq(reviews.shopId, shopId)),
    db
      .select({
        historical: sql<number>`count(*)`,
        new7d: sql<number>`sum(case when ${painPoints.firstSeenAt} >= ${newPainPointThreshold} then 1 else 0 end)`,
      })
      .from(painPoints)
      .where(and(eq(painPoints.shopId, shopId), eq(painPoints.status, "active"))),
    db
      .select({
        date: sql<string>`date(${reviews.reviewTime}, 'unixepoch', 'localtime')`,
        count: sql<number>`count(*)`,
      })
      .from(reviews)
      .where(and(eq(reviews.shopId, shopId), gte(reviews.reviewTime, trendThreshold)))
      .groupBy(sql`date(${reviews.reviewTime}, 'unixepoch', 'localtime')`)
      .orderBy(sql`date(${reviews.reviewTime}, 'unixepoch', 'localtime')`),
    db
      .select({
        canonicalLabel: painPoints.canonicalLabel,
        category: sql<PainPointCategory>`${painPoints.category}`,
        occurrenceCount: painPoints.occurrenceCount,
        lastSeenAt: painPoints.lastSeenAt,
        productLabel: sql<string | null>`coalesce(${products.displayName}, ${products.rawName}, ${products.doudianProductId})`,
      })
      .from(painPoints)
      .leftJoin(products, eq(products.id, painPoints.productRefId))
      .where(and(eq(painPoints.shopId, shopId), eq(painPoints.status, "active"))),
  ]);

  sendSuccess(response, {
    totalReviews: reviewSummary?.totalReviews ?? 0,
    negativeCount: reviewSummary?.negativeCount ?? 0,
    avgRating: reviewSummary?.avgRating ?? 0,
    painPoints: {
      historical: painPointSummary?.historical ?? 0,
      new7d: painPointSummary?.new7d ?? 0,
    },
    trend30d: normalizeTrendRows(trendRows),
    topPainPoints: normalizeTopPainPoints(topPainPointRows),
  });
});
