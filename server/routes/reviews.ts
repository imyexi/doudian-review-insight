import { and, desc, eq, like, sql } from "drizzle-orm";
import { Router } from "express";
import { reviewListQuerySchema } from "@shared/types";
import { db } from "../db/client";
import { productGroups, reviews } from "../db/schema";
import { loadPainPointForShop } from "../services/painPoints";
import { sendError, sendSuccess } from "../utils/http";
import { serializeProductGroup } from "../utils/productGroups";

export const reviewsRouter = Router();

function buildPainPointReviewCondition(shopId: number, painPointId: number) {
  return sql`${reviews.id} in (
    select ppe.review_id
    from pain_point_evidence ppe
    inner join reviews evidence_reviews on evidence_reviews.id = ppe.review_id
    where ppe.pain_point_id = ${painPointId}
      and evidence_reviews.shop_id = ${shopId}
      and evidence_reviews.shop_id = ${reviews.shopId}
  )`;
}

reviewsRouter.get("/", async (request, response) => {
  const parsed = reviewListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    sendError(response, "INVALID_QUERY", parsed.error.issues[0]?.message ?? "筛选参数无效", 400);
    return;
  }

  const { shopId, page, pageSize, productRefId, productGroupId, painPointId, rating, spec, q } = parsed.data;
  const scopedPainPoint = painPointId ? await loadPainPointForShop(shopId, painPointId) : null;

  if (painPointId && !scopedPainPoint) {
    sendSuccess(response, {
      items: [],
      total: 0,
      page,
      pageSize,
    });
    return;
  }

  const conditions = [eq(reviews.shopId, shopId)];

  if (productRefId) {
    conditions.push(eq(reviews.productRefId, productRefId));
  }

  if (productGroupId) {
    conditions.push(eq(reviews.productGroupId, productGroupId));
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

  if (painPointId && scopedPainPoint) {
    conditions.push(buildPainPointReviewCondition(shopId, scopedPainPoint.id));
  }

  const whereClause = and(...conditions);
  const offset = (page - 1) * pageSize;

  const [summary] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reviews)
    .where(whereClause);

  const items = await db
    .select({
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
      productGroup: {
        id: productGroups.id,
        shopId: productGroups.shopId,
        name: productGroups.name,
        shortName: productGroups.shortName,
        createdAt: productGroups.createdAt,
        updatedAt: productGroups.updatedAt,
      },
    })
    .from(reviews)
    .leftJoin(productGroups, eq(productGroups.id, reviews.productGroupId))
    .where(whereClause)
    .orderBy(desc(reviews.reviewTime), desc(reviews.id))
    .limit(pageSize)
    .offset(offset);

  sendSuccess(response, {
    items: items.map(item => ({
      ...item,
      productGroup: serializeProductGroup(item.productGroup),
    })),
    total: summary?.count ?? 0,
    page,
    pageSize,
  });
});
