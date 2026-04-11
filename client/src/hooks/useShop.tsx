import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { Shop } from "@shared/types";
import { apiGet } from "@/api/client";

const SELECTED_SHOP_STORAGE_KEY = "doudian-review-selected-shop";

interface ShopContextValue {
  shops: Shop[];
  isLoading: boolean;
  selectedShop: Shop | null;
  selectedShopId: number | null;
  setSelectedShopId: (shopId: number | null) => void;
}

const ShopContext = createContext<ShopContextValue | null>(null);

function readStoredShopId(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(SELECTED_SHOP_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  const numericValue = Number(rawValue);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function persistSelectedShopId(shopId: number | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (shopId === null) {
    window.localStorage.removeItem(SELECTED_SHOP_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SELECTED_SHOP_STORAGE_KEY, String(shopId));
}

export function ShopProvider({ children, enabled }: PropsWithChildren<{ enabled: boolean }>): ReactElement {
  const [selectedShopId, setSelectedShopIdState] = useState<number | null>(() => readStoredShopId());
  const shopsQuery = useQuery({
    queryKey: ["shops"],
    queryFn: () => apiGet<Shop[]>("/shops"),
    enabled,
    staleTime: 30_000,
  });

  const shops = shopsQuery.data ?? [];

  const setSelectedShopId = useCallback((shopId: number | null) => {
    setSelectedShopIdState(shopId);
    persistSelectedShopId(shopId);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (shops.length === 0) {
      if (selectedShopId !== null) {
        setSelectedShopId(null);
      }
      return;
    }

    const hasSelectedShop = selectedShopId !== null && shops.some(shop => shop.id === selectedShopId);
    if (!hasSelectedShop) {
      setSelectedShopId(shops[0]?.id ?? null);
    }
  }, [enabled, selectedShopId, setSelectedShopId, shops]);

  const selectedShop = useMemo(
    () => shops.find(shop => shop.id === selectedShopId) ?? null,
    [selectedShopId, shops],
  );

  const value = useMemo<ShopContextValue>(
    () => ({
      shops,
      isLoading: shopsQuery.isLoading,
      selectedShop,
      selectedShopId,
      setSelectedShopId,
    }),
    [selectedShop, selectedShopId, setSelectedShopId, shops, shopsQuery.isLoading],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error("useShop must be used within ShopProvider");
  }

  return context;
}
