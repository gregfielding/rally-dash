"use client";

import useSWR from "swr";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  RpProductDesign,
  RpDesignStatus,
} from "@/lib/types/firestore";

export interface UseProductDesignsFilters {
  productId: string;
  status?: RpDesignStatus;
}

async function fetchRPProductDesigns(
  filters: UseProductDesignsFilters
): Promise<RpProductDesign[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_product_designs");
  const conditions: any[] = [where("productId", "==", filters.productId)];

  if (filters.status) {
    conditions.push(where("status", "==", filters.status));
  }

  // Add orderBy
  conditions.push(orderBy("createdAt", "desc"));

  try {
    const q = query(base, ...conditions);
    const snapshot = await getDocs(q);
    const designs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductDesign) }));
    return designs;
  } catch (error: any) {
    // If orderBy fails due to missing index, try without orderBy
    if (error?.code === "failed-precondition" && error?.message?.includes("index")) {
      const conditionsWithoutOrder = conditions.filter(c => c.type !== "orderBy");
      const q = query(base, ...conditionsWithoutOrder);
      const snapshot = await getDocs(q);
      const designs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductDesign) }));
      // Sort in memory
      designs.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      return designs;
    }
    throw error;
  }
}

/**
 * Hook to fetch product designs
 */
export function useProductDesigns(filters: UseProductDesignsFilters | null) {
  const { data, error, isLoading, mutate } = useSWR<RpProductDesign[]>(
    filters ? `rp_product_designs:${JSON.stringify(filters)}` : null,
    () => (filters ? fetchRPProductDesigns(filters) : []),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    designs: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}
