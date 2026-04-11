import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { productInputSchema } from "@shared/types";
import { db } from "../db/client";
import { painPoints, products, reviews, shops } from "../db/schema";
import { sendError, sendSuccess } from "../utils/http";

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getShopIdParam(request: { params: Record<string, string | undefined> }): number {
  return Number(request.params.shopId);
}

async function shopExists(shopId: number): Promise<boolean> {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  return Boolean(shop);
}

export const productsRouter = Router({ mergeParams: true });

productsRouter.get("/", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const rows = await db
    .select({
      id: products.id,
      shopId: products.shopId,
      doudianProductId: products.doudianProductId,
      displayName: products.displayName,
      rawName: products.rawName,
      category: products.category,
      notes: products.notes,
      enabled: products.enabled,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      latestReviewTime: sql<number | null>`max(${reviews.reviewTime})`,
      painPointCount: sql<number>`count(distinct ${painPoints.id})`,
    })
    .from(products)
    .leftJoin(reviews, eq(reviews.productRefId, products.id))
    .leftJoin(painPoints, eq(painPoints.productRefId, products.id))
    .where(eq(products.shopId, shopId))
    .groupBy(products.id)
    .orderBy(desc(sql`coalesce(max(${reviews.reviewTime}), 0)`), desc(products.updatedAt));

  sendSuccess(response, rows);
});

productsRouter.post("/", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  if (!(await shopExists(shopId))) {
    sendError(response, "NOT_FOUND", "店铺不存在", 404);
    return;
  }

  const parsed = productInputSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "商品参数无效", 400);
    return;
  }

  const [created] = await db
    .insert(products)
    .values({
      shopId,
      doudianProductId: parsed.data.doudianProductId.trim(),
      displayName: normalizeOptional(parsed.data.displayName),
      rawName: normalizeOptional(parsed.data.rawName),
      category: normalizeOptional(parsed.data.category),
      notes: normalizeOptional(parsed.data.notes),
      enabled: parsed.data.enabled ?? true,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .returning();

  sendSuccess(response, created, 201);
});

productsRouter.patch("/:productId", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  const productId = Number(request.params.productId);
  if (!Number.isInteger(shopId) || shopId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    sendError(response, "INVALID_ID", "商品 ID 无效", 400);
    return;
  }

  const parsed = productInputSchema.partial().safeParse(request.body);
  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "商品参数无效", 400);
    return;
  }

  const nextValues = {
    ...(parsed.data.doudianProductId ? { doudianProductId: parsed.data.doudianProductId.trim() } : {}),
    ...(parsed.data.displayName !== undefined
      ? { displayName: normalizeOptional(parsed.data.displayName) }
      : {}),
    ...(parsed.data.rawName !== undefined ? { rawName: normalizeOptional(parsed.data.rawName) } : {}),
    ...(parsed.data.category !== undefined ? { category: normalizeOptional(parsed.data.category) } : {}),
    ...(parsed.data.notes !== undefined ? { notes: normalizeOptional(parsed.data.notes) } : {}),
    ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    updatedAt: Math.floor(Date.now() / 1000),
  };

  const [updated] = await db
    .update(products)
    .set(nextValues)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .returning();

  if (!updated) {
    sendError(response, "NOT_FOUND", "商品不存在", 404);
    return;
  }

  sendSuccess(response, updated);
});

productsRouter.delete("/:productId", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  const productId = Number(request.params.productId);
  if (!Number.isInteger(shopId) || shopId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    sendError(response, "INVALID_ID", "商品 ID 无效", 400);
    return;
  }

  const deleted = await db
    .delete(products)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .returning({ id: products.id });

  if (!deleted[0]) {
    sendError(response, "NOT_FOUND", "商品不存在", 404);
    return;
  }

  sendSuccess(response, { id: productId, deleted: true });
});
