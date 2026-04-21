import type { ProductGroup } from "@shared/types";

interface NullableProductGroupShape {
  id: number | null;
  shopId: number | null;
  name: string | null;
  shortName: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export function serializeProductGroup(group: NullableProductGroupShape | null | undefined): ProductGroup | null {
  if (!group || group.id === null || group.shopId === null || group.name === null || group.shortName === null || group.createdAt === null || group.updatedAt === null) {
    return null;
  }

  return {
    id: group.id,
    shopId: group.shopId,
    name: group.name,
    shortName: group.shortName,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
