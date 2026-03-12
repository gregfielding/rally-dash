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
  RpProductAsset,
  RpAssetStatus,
} from "@/lib/types/firestore";

export interface UseProductAssetsFilters {
  productId: string;
  productSlug?: string; // Optional: also try matching by slug
  status?: RpAssetStatus;
  presetId?: string;
  identityId?: string;
  designId?: string;
}

async function fetchRPProductAssets(
  filters: UseProductAssetsFilters
): Promise<RpProductAsset[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_product_assets");
  const conditions: any[] = [where("productId", "==", filters.productId)];

  if (filters.status) {
    conditions.push(where("status", "==", filters.status));
  }
  if (filters.presetId) {
    conditions.push(where("presetId", "==", filters.presetId));
  }
  if (filters.identityId) {
    conditions.push(where("identityId", "==", filters.identityId));
  }
  if (filters.designId) {
    conditions.push(where("designId", "==", filters.designId));
  }

  // Try query with orderBy, fallback to in-memory sort if index missing
  try {
    conditions.push(orderBy("createdAt", "desc"));
    const q = query(base, ...conditions);
    const snapshot = await getDocs(q);

    // If no assets found by productId, try alternative lookups
    if (snapshot.docs.length === 0 && filters.productSlug) {
      // Try 1: productSlug field matches slug
      try {
        const slugConditions: any[] = [where("productSlug", "==", filters.productSlug)];
        if (filters.status) slugConditions.push(where("status", "==", filters.status));
        slugConditions.push(orderBy("createdAt", "desc"));
        const slugQuery = query(base, ...slugConditions);
        const slugSnapshot = await getDocs(slugQuery);
        if (slugSnapshot.docs.length > 0) {
          return slugSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }));
        }
      } catch (slugErr) {
        console.warn("[fetchRPProductAssets] productSlug fallback query failed:", slugErr);
      }
      
      // Try 2: productId field contains the slug (old data might have stored slug as productId)
      try {
        const slugAsIdConditions: any[] = [where("productId", "==", filters.productSlug)];
        if (filters.status) slugAsIdConditions.push(where("status", "==", filters.status));
        slugAsIdConditions.push(orderBy("createdAt", "desc"));
        const slugAsIdQuery = query(base, ...slugAsIdConditions);
        const slugAsIdSnapshot = await getDocs(slugAsIdQuery);
        if (slugAsIdSnapshot.docs.length > 0) {
          return slugAsIdSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }));
        }
      } catch (slugAsIdErr) {
        console.warn("[fetchRPProductAssets] productId=slug fallback query failed:", slugAsIdErr);
      }
    }
    
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }));
  } catch (error: any) {
    if (error?.code === "failed-precondition" && error?.message?.includes("index")) {
      console.warn("[fetchRPProductAssets] Index missing, falling back to query without orderBy");
      // Remove orderBy and sort in memory
      const conditionsWithoutOrder = conditions.filter(c => c.type !== "orderBy");
      const q = query(base, ...conditionsWithoutOrder);
      const snapshot = await getDocs(q);
      const assets = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }));
      // Sort in memory by createdAt descending
      assets.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
      return assets;
    }
    throw error;
  }
}

/**
 * Hook to fetch product assets with optional filters
 */
export function useProductAssets(filters: UseProductAssetsFilters | null) {
  const { data, error, isLoading, mutate } = useSWR<RpProductAsset[]>(
    filters ? `rp_product_assets:${JSON.stringify(filters)}` : null,
    () => (filters ? fetchRPProductAssets(filters) : []),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    assets: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}
