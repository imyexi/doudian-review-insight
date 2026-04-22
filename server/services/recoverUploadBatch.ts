import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { products, reviews, uploads } from "../db/schema";
import { analyzeQueue } from "../jobs/queue";
import { toDistinctPositiveIds, deleteAffectedOrphanProductGroups } from "./deleteUploadBatch";
import { rebuildPainPointsForProductGroups } from "./painPointAggregation";
import type { UploadRow } from "../db/schema";

export type RecoverUploadResult =
  | { ok: true; upload: UploadRow }
  | { ok: false; code: string; message: string; status: number };

export async function recoverUploadBatch(shopId: number, uploadId: number): Promise<RecoverUploadResult> {
  const [existing] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.shopId, shopId)))
    .limit(1);

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "上传记录不存在", status: 404 };
  }

  if (existing.status !== "failed") {
    return { ok: false, code: "INVALID_STATUS", message: `当前状态为 ${existing.status}，只有失败的上传可以继续分析`, status: 409 };
  }

  if (!fs.existsSync(existing.storedPath)) {
    return { ok: false, code: "FILE_MISSING", message: "源文件已丢失，无法继续分析", status: 409 };
  }

  const affectedReviews = await db
    .select({
      productGroupId: reviews.productGroupId,
      productRefId: reviews.productRefId,
    })
    .from(reviews)
    .where(and(eq(reviews.shopId, shopId), eq(reviews.uploadId, uploadId)));

  const affectedGroupIds = toDistinctPositiveIds(affectedReviews.map(row => row.productGroupId));
  const affectedProductIds = toDistinctPositiveIds(affectedReviews.map(row => row.productRefId));

  await db.delete(reviews).where(and(eq(reviews.shopId, shopId), eq(reviews.uploadId, uploadId)));

  if (affectedProductIds.length > 0) {
    const remainingProductReferences = await db
      .select({ productRefId: reviews.productRefId })
      .from(reviews)
      .where(and(eq(reviews.shopId, shopId), inArray(reviews.productRefId, affectedProductIds)));

    const referencedProductIds = new Set(toDistinctPositiveIds(remainingProductReferences.map(row => row.productRefId)));
    const orphanProductIds = affectedProductIds.filter(id => !referencedProductIds.has(id));

    if (orphanProductIds.length > 0) {
      await db.delete(products).where(and(eq(products.shopId, shopId), inArray(products.id, orphanProductIds)));
    }
  }

  if (affectedGroupIds.length > 0) {
    await rebuildPainPointsForProductGroups(shopId, affectedGroupIds);
    await deleteAffectedOrphanProductGroups(shopId, affectedGroupIds);
  }

  await db
    .update(uploads)
    .set({
      status: "queued",
      error: null,
      finishedAt: null,
      progressCurrent: 0,
      progressTotal: 0,
      rowCount: null,
    })
    .where(and(eq(uploads.id, uploadId), eq(uploads.shopId, shopId)));

  const [updated] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.shopId, shopId)))
    .limit(1);

  analyzeQueue.enqueueUpload(uploadId);

  return { ok: true, upload: updated };
}
