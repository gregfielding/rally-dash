"use client";

import useSWR from "swr";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RpInspiration, RpInspirationSource, RpProductCategory } from "@/lib/types/firestore";

export interface UseInspirationsFilters {
  sourceType?: RpInspirationSource;
  category?: RpProductCategory;
  tags?: string[];
  search?: string; // Search in title/description
}

async function fetchInspirations(
  filters?: UseInspirationsFilters
): Promise<RpInspiration[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_inspirations");
  const conditions: any[] = [];

  if (filters?.sourceType) {
    conditions.push(where("sourceType", "==", filters.sourceType));
  }
  if (filters?.category) {
    conditions.push(where("category", "==", filters.category));
  }

  // Add orderBy
  conditions.push(orderBy("createdAt", "desc"));

  const q = query(base, ...conditions);
  const snapshot = await getDocs(q);
  let inspirations = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RpInspiration),
  }));

  // Client-side filtering for tags and search (since Firestore doesn't support array-contains-any easily)
  if (filters?.tags && filters.tags.length > 0) {
    inspirations = inspirations.filter((insp) =>
      filters.tags!.some((tag) => insp.tags.includes(tag))
    );
  }

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    inspirations = inspirations.filter(
      (insp) =>
        insp.title.toLowerCase().includes(searchLower) ||
        insp.description?.toLowerCase().includes(searchLower) ||
        insp.tags.some((tag) => tag.toLowerCase().includes(searchLower))
    );
  }

  return inspirations;
}

/**
 * Hook to fetch inspirations with optional filters
 */
export function useInspirations(filters?: UseInspirationsFilters | null) {
  const { data, error, isLoading, mutate } = useSWR<RpInspiration[]>(
    filters ? `rp_inspirations:${JSON.stringify(filters)}` : "rp_inspirations:all",
    () => fetchInspirations(filters || undefined),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    inspirations: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}
