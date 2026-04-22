import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { painPoints, productGroups, products, uploads, reviews } from "../db/schema";
import { env } from "../env";
import { analyzeQueue } from "../jobs/queue";
import { rebuildPainPointsForProductGroups } from "./painPointAggregation";
import { logger } from "../utils/logger";

interface DeleteUploadBatchResult {
  deleted: boolean;
  id: number;
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function toDistinctPositiveIds(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0))];
}

function removeStoredUploadFile(storedPath: string, uploadId: number): void {
  const resolvedStoredPath = path.resolve(storedPath);
  if (!isPathWithin(env.DATA_DIR, resolvedStoredPath)) {
    logger.warn({ uploadId, storedPath: resolvedStoredPath }, "skipped upload file removal outside data directory");
    return;
  }

  try {
    fs.rmSync(resolvedStoredPath, { force: true });
  } catch (error) {
    logger.warn({ error, uploadId, storedPath: resolvedStoredPath }, "failed to remove upload file after deleting batch");
  }
}

export async function deleteAffectedOrphanProductGroups(shopId: number, groupIds: number[]): Promise<void> {
  if (groupIds.length === 0) {
    return;
  }

  const [remainingProducts, remainingReviews, remainingPainPoints] = await Promise.all([
    db
      .select({ productGroupId: products.productGroupId })
      .from(products)
      .where(and(eq(products.shopId, shopId), inArray(products.productGroupId, groupIds))),
    db
      .select({ productGroupId: reviews.productGroupId })
      .from(reviews)
      .where(and(eq(reviews.shopId, shopId), inArray(reviews.productGroupId, groupIds))),
    db
      .select({ productGroupId: painPoints.productGroupId })
      .from(painPoints)
      .where(and(eq(painPoints.shopId, shopId), inArray(painPoints.productGroupId, groupIds))),
  ]);

  const referencedGroupIds = new Set([
    ...toDistinctPositiveIds(remainingProducts.map(row => row.productGroupId)),
    ...toDistinctPositiveIds(remainingReviews.map(row => row.productGroupId)),
    ...toDistinctPositiveIds(remainingPainPoints.map(row => row.productGroupId)),
  ]);

  const orphanGroupIds = groupIds.filter(groupId => !referencedGroupIds.has(groupId));
  if (orphanGroupIds.length === 0) {
    return;
  }

  await db.delete(productGroups).where(and(eq(productGroups.shopId, shopId), inArray(productGroups.id, orphanGroupIds)));
}

export async function deleteUploadBatch(shopId: number, uploadId: number): Promise<DeleteUploadBatchResult | null> {
  const [existingUpload] = await db
    .select({
      id: uploads.id,
      shopId: uploads.shopId,
      storedPath: uploads.storedPath,
    })
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.shopId, shopId)))
    .limit(1);

  if (!existingUpload) {
    return null;
  }

  analyzeQueue.cancel(String(uploadId));

  const affectedReviews = await db
    .select({
      productGroupId: reviews.productGroupId,
      productRefId: reviews.productRefId,
    })
    .from(reviews)
    .where(and(eq(reviews.shopId, existingUpload.shopId), eq(reviews.uploadId, uploadId)));

  const affectedGroupIds = toDistinctPositiveIds(affectedReviews.map(review => review.productGroupId));
  const affectedProductIds = toDistinctPositiveIds(affectedReviews.map(review => review.productRefId));

  await db.transaction(async tx => {
    await tx.delete(uploads).where(and(eq(uploads.id, uploadId), eq(uploads.shopId, existingUpload.shopId)));

    if (affectedProductIds.length === 0) {
      return;
    }

    const remainingProductReferences = await tx
      .select({ productRefId: reviews.productRefId })
      .from(reviews)
      .where(and(eq(reviews.shopId, existingUpload.shopId), inArray(reviews.productRefId, affectedProductIds)));

    const referencedProductIds = new Set(toDistinctPositiveIds(remainingProductReferences.map(row => row.productRefId)));
    const orphanProductIds = affectedProductIds.filter(productId => !referencedProductIds.has(productId));

    if (orphanProductIds.length === 0) {
      return;
    }

    await tx.delete(products).where(and(eq(products.shopId, existingUpload.shopId), inArray(products.id, orphanProductIds)));
  });

  await rebuildPainPointsForProductGroups(existingUpload.shopId, affectedGroupIds);
  await deleteAffectedOrphanProductGroups(existingUpload.shopId, affectedGroupIds);
  removeStoredUploadFile(existingUpload.storedPath, uploadId);

  return {
    id: uploadId,
    deleted: true,
  };
}
