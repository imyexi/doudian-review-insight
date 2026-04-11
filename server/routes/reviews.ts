import { and, desc, eq, like, sql } from "drizzle-orm";
import { Router } from "express";
import { reviewListQuerySchema } from "@shared/types";
import { db } from "../db/client";
import { reviews } from "../db/schema";
import { sendError, sendSuccess } from "../utils/http";

export const reviewsRouter = Router();

reviewsRouter.get("/", async (request, response) => {
  const parsed = reviewListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    sendError(response, "INVALID_QUERY", parsed.error.issues[0]?.message ?? "筛选参数无效", 400);
    return;
  }

  const { shopId, page, pageSize, productRefId, painPointId, rating, spec, q } = parsed.data;
  const conditions = [eq(reviews.shopId, shopId)];

  if (productRefId) {
    conditions.push(eq(reviews.productRefId, productRefId));
  }

  if (rating) {
    conditions.push(eq(reviews.rating, rating));
  }

  if (spec) {
    conditions.push(like(reviews.productSpec, `%${spec}%`));
  }

  if (q) {
    conditions.push(sql`(${reviews.content} like ${`%${q}%`} or ${reviews.appendContent} like ${`%${q}%`})`);
  }

  if (painPointId) {
    conditions.push(sql`${reviews.id} in (select review_id from pain_point_evidence where pain_point_id = ${painPointId})`);
  }

  const whereClause = and(...conditions);
  const offset = (page - 1) * pageSize;

  const [summary] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reviews)
    .where(whereClause);

  const items = await db
    .select()
    .from(reviews)
    .where(whereClause)
    .orderBy(desc(reviews.reviewTime), desc(reviews.id))
    .limit(pageSize)
    .offset(offset);

  sendSuccess(response, {
    items,
    total: summary?.count ?? 0,
    page,
    pageSize,
  });
});
