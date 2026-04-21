import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { painPoints } from "../db/schema";

export interface ShopScopedPainPoint {
  id: number;
  productGroupId: number | null;
}

export async function loadPainPointForShop(shopId: number, painPointId: number): Promise<ShopScopedPainPoint | null> {
  const [painPoint] = await db
    .select({
      id: painPoints.id,
      productGroupId: painPoints.productGroupId,
    })
    .from(painPoints)
    .where(and(eq(painPoints.id, painPointId), eq(painPoints.shopId, shopId)))
    .limit(1);

  return painPoint ?? null;
}
