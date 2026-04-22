import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { productInputSchema, productRegroupSchema } from "@shared/types";
import { db } from "../db/client";
import { painPoints, productGroups, products, reviews, shops } from "../db/schema";
import { resolveProductGrouping } from "../services/productGrouping";
import { rebuildProductGroupAnalytics, syncReviewsToProductGroup } from "../services/rebuildProductGroupAnalytics";
import { sendError, sendSuccess } from "../utils/http";
import { serializeProductGroup } from "../utils/productGroups";

interface ProductRowWithStats {
  id: number;
  shopId: number;
  productGroupId: number | null;
  doudianProductId: string;
  displayName: string | null;
  rawName: string | null;
  shortName: string | null;
  llmExtractedName: string | null;
  category: string | null;
  notes: string | null;
  classificationSource: string;
  classificationLocked: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  latestReviewTime: number | null;
  painPointCount: number;
  productGroup: {
    id: number | null;
    shopId: number | null;
    name: string | null;
    shortName: string | null;
    createdAt: number | null;
    updatedAt: number | null;
  } | null;
}

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

function serializeProductRow(row: ProductRowWithStats) {
  return {
    ...row,
    productGroup: serializeProductGroup(row.productGroup),
  };
}

async function listProducts(shopId: number, productId?: number) {
  const conditions = [eq(products.shopId, shopId)];
  if (productId) {
    conditions.push(eq(products.id, productId));
  }

  const rows = await db
    .select({
      id: products.id,
      shopId: products.shopId,
      productGroupId: products.productGroupId,
      doudianProductId: products.doudianProductId,
      displayName: products.displayName,
      rawName: products.rawName,
      shortName: products.shortName,
      llmExtractedName: products.llmExtractedName,
      category: products.category,
      notes: products.notes,
      classificationSource: products.classificationSource,
      classificationLocked: products.classificationLocked,
      enabled: products.enabled,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      latestReviewTime: sql<number | null>`max(${reviews.reviewTime})`,
      painPointCount: sql<number>`count(distinct ${painPoints.id})`,
      productGroup: {
        id: productGroups.id,
        shopId: productGroups.shopId,
        name: productGroups.name,
        shortName: productGroups.shortName,
        createdAt: productGroups.createdAt,
        updatedAt: productGroups.updatedAt,
      },
    })
    .from(products)
    .leftJoin(productGroups, eq(productGroups.id, products.productGroupId))
    .leftJoin(reviews, eq(reviews.productRefId, products.id))
    .leftJoin(painPoints, eq(painPoints.productGroupId, products.productGroupId))
    .where(and(...conditions))
    .groupBy(products.id, productGroups.id)
    .orderBy(desc(sql`coalesce(max(${reviews.reviewTime}), 0)`), desc(products.updatedAt));

  return rows.map(serializeProductRow);
}

async function loadProductOrNull(shopId: number, productId: number) {
  const [row] = await listProducts(shopId, productId);
  return row ?? null;
}

async function listProductGroups(shopId: number) {
  return db
    .select({
      id: productGroups.id,
      shopId: productGroups.shopId,
      name: productGroups.name,
      shortName: productGroups.shortName,
      createdAt: productGroups.createdAt,
      updatedAt: productGroups.updatedAt,
      productCount: sql<number>`count(distinct ${products.id})`,
      painPointCount: sql<number>`count(distinct ${painPoints.id})`,
    })
    .from(productGroups)
    .leftJoin(products, eq(products.productGroupId, productGroups.id))
    .leftJoin(painPoints, eq(painPoints.productGroupId, productGroups.id))
    .where(eq(productGroups.shopId, shopId))
    .groupBy(productGroups.id)
    .orderBy(desc(productGroups.updatedAt), productGroups.name);
}

export const productsRouter = Router({ mergeParams: true });

productsRouter.get("/", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  sendSuccess(response, await listProducts(shopId));
});

productsRouter.get("/groups", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  sendSuccess(response, await listProductGroups(shopId));
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

  const displayName = normalizeOptional(parsed.data.displayName);
  const rawName = normalizeOptional(parsed.data.rawName);
  const shortNameOverride = normalizeOptional(parsed.data.shortName);
  const grouping = await resolveProductGrouping({
    shopId,
    doudianProductId: parsed.data.doudianProductId.trim(),
    displayName,
    rawName,
    shortNameOverride,
  });

  const [created] = await db
    .insert(products)
    .values({
      shopId,
      productGroupId: grouping.productGroup.id,
      doudianProductId: parsed.data.doudianProductId.trim(),
      displayName,
      rawName,
      shortName: grouping.shortName,
      category: normalizeOptional(parsed.data.category),
      notes: normalizeOptional(parsed.data.notes),
      classificationSource: grouping.classificationSource,
      classificationLocked: false,
      enabled: parsed.data.enabled ?? true,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .returning({ id: products.id });

  sendSuccess(response, await loadProductOrNull(shopId, created.id), 201);
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

  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .limit(1);

  if (!existing) {
    sendError(response, "NOT_FOUND", "商品不存在", 404);
    return;
  }

  const nextDoudianProductId = parsed.data.doudianProductId?.trim() ?? existing.doudianProductId;
  const nextDisplayName = parsed.data.displayName !== undefined ? normalizeOptional(parsed.data.displayName) : existing.displayName;
  const nextRawName = parsed.data.rawName !== undefined ? normalizeOptional(parsed.data.rawName) : existing.rawName;
  const nextValues = {
    ...(parsed.data.doudianProductId ? { doudianProductId: nextDoudianProductId } : {}),
    ...(parsed.data.displayName !== undefined ? { displayName: nextDisplayName } : {}),
    ...(parsed.data.rawName !== undefined ? { rawName: nextRawName } : {}),
    ...(parsed.data.category !== undefined ? { category: normalizeOptional(parsed.data.category) } : {}),
    ...(parsed.data.notes !== undefined ? { notes: normalizeOptional(parsed.data.notes) } : {}),
    ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    updatedAt: Math.floor(Date.now() / 1000),
  } as Record<string, unknown>;

  let nextGroupId = existing.productGroupId;

  if (!existing.classificationLocked) {
    const grouping = await resolveProductGrouping({
      shopId,
      doudianProductId: nextDoudianProductId,
      displayName: nextDisplayName,
      rawName: nextRawName,
      shortNameOverride: normalizeOptional(parsed.data.shortName),
    });

    nextGroupId = grouping.productGroup.id;
    nextValues.productGroupId = grouping.productGroup.id;
    nextValues.shortName = grouping.shortName;
    nextValues.classificationSource = grouping.classificationSource;
  }

  await db
    .update(products)
    .set(nextValues)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)));

  if (nextGroupId !== existing.productGroupId && nextGroupId !== null) {
    await syncReviewsToProductGroup(productId, nextGroupId);
    await rebuildProductGroupAnalytics(shopId, [existing.productGroupId, nextGroupId]);
  }

  sendSuccess(response, await loadProductOrNull(shopId, productId));
});

productsRouter.patch("/:productId/regroup", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  const productId = Number(request.params.productId);
  if (!Number.isInteger(shopId) || shopId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    sendError(response, "INVALID_ID", "商品 ID 无效", 400);
    return;
  }

  const parsed = productRegroupSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "商品归组参数无效", 400);
    return;
  }

  const [existing, targetGroup] = await Promise.all([
    db.select().from(products).where(and(eq(products.id, productId), eq(products.shopId, shopId))).limit(1),
    db.select().from(productGroups).where(and(eq(productGroups.id, parsed.data.productGroupId), eq(productGroups.shopId, shopId))).limit(1),
  ]);

  const currentProduct = existing[0];
  const nextGroup = targetGroup[0];

  if (!currentProduct) {
    sendError(response, "NOT_FOUND", "商品不存在", 404);
    return;
  }

  if (!nextGroup) {
    sendError(response, "NOT_FOUND", "目标商品组不存在", 404);
    return;
  }

  await db
    .update(products)
    .set({
      productGroupId: nextGroup.id,
      shortName: nextGroup.shortName,
      classificationSource: "manual",
      classificationLocked: true,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)));

  await syncReviewsToProductGroup(productId, nextGroup.id);
  await rebuildProductGroupAnalytics(shopId, [currentProduct.productGroupId, nextGroup.id]);

  sendSuccess(response, await loadProductOrNull(shopId, productId));
});

productsRouter.delete("/:productId", async (request, response) => {
  const shopId = getShopIdParam(request as { params: Record<string, string | undefined> });
  const productId = Number(request.params.productId);
  if (!Number.isInteger(shopId) || shopId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    sendError(response, "INVALID_ID", "商品 ID 无效", 400);
    return;
  }

  const [existing] = await db
    .select({
      id: products.id,
      productGroupId: products.productGroupId,
    })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .limit(1);

  if (!existing) {
    sendError(response, "NOT_FOUND", "商品不存在", 404);
    return;
  }

  await db
    .update(reviews)
    .set({ productGroupId: null })
    .where(eq(reviews.productRefId, productId));

  await db.delete(products).where(and(eq(products.id, productId), eq(products.shopId, shopId)));
  await rebuildProductGroupAnalytics(shopId, [existing.productGroupId]);

  sendSuccess(response, { id: productId, deleted: true });
});
