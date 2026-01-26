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
  RpGenerationJob,
  RpJobStatus,
} from "@/lib/types/firestore";

export interface UseGenerationJobsFilters {
  productId?: string;
  identityId?: string;
  status?: RpJobStatus;
  limit?: number;
}

async function fetchRPGenerationJobs(
  filters?: UseGenerationJobsFilters
): Promise<RpGenerationJob[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_generation_jobs");
  const conditions: any[] = [];

  if (filters?.productId) {
    conditions.push(where("productId", "==", filters.productId));
  }
  if (filters?.identityId) {
    conditions.push(where("identityId", "==", filters.identityId));
  }
  if (filters?.status) {
    conditions.push(where("status", "==", filters.status));
  }

  // Add orderBy (required if using where)
  if (conditions.length > 0) {
    conditions.push(orderBy("createdAt", "desc"));
    const q = query(base, ...conditions);
    const snapshot = await getDocs(q);
    let jobs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpGenerationJob) }));

    // Apply limit
    if (filters?.limit) {
      jobs = jobs.slice(0, filters.limit);
    }

    return jobs;
  } else {
    const q = query(base, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    let jobs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpGenerationJob) }));

    // Apply limit
    if (filters?.limit) {
      jobs = jobs.slice(0, filters.limit);
    }

    return jobs;
  }
}

/**
 * Hook to fetch generation jobs
 */
export function useGenerationJobs(filters?: UseGenerationJobsFilters) {
  const cacheKey = `rp_generation_jobs:${JSON.stringify(filters || {})}`;

  const { data, error, isLoading, mutate } = useSWR<RpGenerationJob[]>(
    cacheKey,
    () => fetchRPGenerationJobs(filters),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 2000, // Jobs update frequently
      keepPreviousData: true,
    }
  );

  return {
    jobs: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}
