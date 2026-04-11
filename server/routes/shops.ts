import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { shopInputSchema } from "@shared/types";
import { db } from "../db/client";
import { shops } from "../db/schema";
import { sendError, sendSuccess } from "../utils/http";

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const shopsRouter = Router();

shopsRouter.get("/", async (_request, response) => {
  const items = await db.select().from(shops).orderBy(shops.createdAt, shops.id);
  sendSuccess(response, items);
});

shopsRouter.post("/", async (request, response) => {
  const parsed = shopInputSchema.safeParse(request.body);

  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "店铺参数无效", 400);
    return;
  }

  const [created] = await db
    .insert(shops)
    .values({
      name: parsed.data.name.trim(),
      doudianShopId: normalizeOptional(parsed.data.doudianShopId),
      description: normalizeOptional(parsed.data.description),
    })
    .returning();

  sendSuccess(response, created, 201);
});

shopsRouter.patch("/:id", async (request, response) => {
  const shopId = Number(request.params.id);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const parsed = shopInputSchema.partial().safeParse(request.body);
  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "店铺参数无效", 400);
    return;
  }

  const nextValues = {
    ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.doudianShopId !== undefined
      ? { doudianShopId: normalizeOptional(parsed.data.doudianShopId) }
      : {}),
    ...(parsed.data.description !== undefined
      ? { description: normalizeOptional(parsed.data.description) }
      : {}),
  };

  const [updated] = await db.update(shops).set(nextValues).where(eq(shops.id, shopId)).returning();

  if (!updated) {
    sendError(response, "NOT_FOUND", "店铺不存在", 404);
    return;
  }

  sendSuccess(response, updated);
});

shopsRouter.delete("/:id", async (request, response) => {
  const shopId = Number(request.params.id);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const deleted = await db.delete(shops).where(eq(shops.id, shopId)).returning({ id: shops.id });
  if (!deleted[0]) {
    sendError(response, "NOT_FOUND", "店铺不存在", 404);
    return;
  }

  sendSuccess(response, { id: shopId, deleted: true });
});

shopsRouter.get("/:id/summary", async (request, response) => {
  const shopId = Number(request.params.id);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const [[productSummary], [reviewSummary], [painPointSummary]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(sql.raw("products")).where(sql`${sql.raw("shop_id")} = ${shopId}`),
    db.select({ count: sql<number>`count(*)` }).from(sql.raw("reviews")).where(sql`${sql.raw("shop_id")} = ${shopId}`),
    db.select({ count: sql<number>`count(*)` }).from(sql.raw("pain_points")).where(sql`${sql.raw("shop_id")} = ${shopId}`),
  ]);

  sendSuccess(response, {
    productCount: productSummary?.count ?? 0,
    reviewCount: reviewSummary?.count ?? 0,
    painPointCount: painPointSummary?.count ?? 0,
  });
});
