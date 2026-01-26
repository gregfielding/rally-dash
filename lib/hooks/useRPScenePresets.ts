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
  RpScenePreset,
  RpSceneType,
} from "@/lib/types/firestore";

export interface UseScenePresetsFilters {
  sceneType?: RpSceneType;
  isActive?: boolean;
}

async function fetchRPScenePresets(
  filters?: UseScenePresetsFilters
): Promise<RpScenePreset[]> {
  if (!db) throw new Error("Database not initialized");

  console.log("[fetchRPScenePresets] Fetching with filters:", filters);

  const base = collection(db, "rp_scene_presets");
  const conditions: any[] = [];

  if (filters?.sceneType) {
    conditions.push(where("sceneType", "==", filters.sceneType));
  }
  if (filters?.isActive !== undefined) {
    conditions.push(where("isActive", "==", filters.isActive));
  }

  // Query without orderBy first to avoid index issues, then sort in memory
  try {
    let q;
    if (conditions.length > 0) {
      q = query(base, ...conditions);
    } else {
      q = query(base);
    }
    const snapshot = await getDocs(q);
    const presets = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpScenePreset) }));
    
    // Sort in memory by name
    presets.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    
    console.log("[fetchRPScenePresets] Found", presets.length, "presets");
    return presets;
  } catch (error: any) {
    console.error("[fetchRPScenePresets] Query error:", error);
    throw error;
  }
}

/**
 * Hook to fetch scene presets
 */
export function useScenePresets(filters?: UseScenePresetsFilters) {
  const cacheKey = `rp_scene_presets:${JSON.stringify(filters || {})}`;

  const { data, error, isLoading, mutate } = useSWR<RpScenePreset[]>(
    cacheKey,
    () => fetchRPScenePresets(filters),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 10000, // Presets change infrequently
      keepPreviousData: true,
    }
  );

  if (error) {
    console.error("[useScenePresets] Error:", error);
  }

  console.log("[useScenePresets] Result:", {
    presetsCount: data?.length || 0,
    loading: isLoading,
    error: error?.message || null,
    filters,
  });

  return {
    presets: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}
