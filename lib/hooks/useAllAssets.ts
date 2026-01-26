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
import { RpProductAsset } from "@/lib/types/firestore";

async function fetchAllAssets(
  productIds?: string[],
  reviewStatus?: "pending" | "needs_revision" | "approved" | "rejected"
): Promise<RpProductAsset[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_product_assets");
  const conditions: any[] = [];

  if (productIds && productIds.length > 0) {
    // Firestore 'in' query supports up to 10 items
    if (productIds.length <= 10) {
      conditions.push(where("productId", "in", productIds));
    } else {
      // For more than 10, we need to batch queries
      const batches: Promise<RpProductAsset[]>[] = [];
      for (let i = 0; i < productIds.length; i += 10) {
        const batch = productIds.slice(i, i + 10);
        batches.push(
          getDocs(query(base, where("productId", "in", batch))).then((snapshot) =>
            snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }))
          )
        );
      }
      const results = await Promise.all(batches);
      let allAssets = results.flat();
      
      // Filter by review status if needed
      if (reviewStatus) {
        allAssets = allAssets.filter((asset) => {
          const assetReviewStatus = asset.review?.status || "pending";
          return assetReviewStatus === reviewStatus;
        });
      }
      
      // Sort by createdAt descending
      allAssets.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
      
      return allAssets;
    }
  }

  // Try query with orderBy, fallback to in-memory sort if index missing
  try {
    if (conditions.length > 0) {
      conditions.push(orderBy("createdAt", "desc"));
    }
    const q = conditions.length > 0 ? query(base, ...conditions) : query(base, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    let assets = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }));
    
    // Filter by review status if needed
    if (reviewStatus) {
      assets = assets.filter((asset) => {
        const assetReviewStatus = asset.review?.status || "pending";
        return assetReviewStatus === reviewStatus;
      });
    }
    
    return assets;
  } catch (error: any) {
    if (error?.code === "failed-precondition" && error?.message?.includes("index")) {
      console.warn("[fetchAllAssets] Index missing, falling back to query without orderBy");
      const q = conditions.length > 0 ? query(base, ...conditions.slice(0, -1)) : query(base);
      const snapshot = await getDocs(q);
      let assets = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpProductAsset) }));
      
      // Filter by review status if needed
      if (reviewStatus) {
        assets = assets.filter((asset) => {
          const assetReviewStatus = asset.review?.status || "pending";
          return assetReviewStatus === reviewStatus;
        });
      }
      
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

export function useAllAssets(
  productIds?: string[],
  reviewStatus?: "pending" | "needs_revision" | "approved" | "rejected"
) {
  const { data, error, isLoading, mutate } = useSWR<RpProductAsset[]>(
    `all_assets:${JSON.stringify({ productIds, reviewStatus })}`,
    () => fetchAllAssets(productIds, reviewStatus),
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
