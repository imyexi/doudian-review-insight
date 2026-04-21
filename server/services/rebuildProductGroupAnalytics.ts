import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { reviews } from "../db/schema";
import { rebuildPainPointsForProductGroups } from "./painPointAggregation";

export async function syncReviewsToProductGroup(productId: number, productGroupId: number): Promise<void> {
  await db.update(reviews).set({ productGroupId }).where(eq(reviews.productRefId, productId));
}

export async function rebuildProductGroupAnalytics(shopId: number, groupIds: Array<number | null>): Promise<void> {
  await rebuildPainPointsForProductGroups(shopId, groupIds);
}
