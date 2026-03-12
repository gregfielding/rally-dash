"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { functions, db } from "@/lib/firebase/config";
import type { RpBulkGenerationJob, RpBulkGenerationJobStatus } from "@/lib/types/firestore";

async function fetchBulkJobs(limitCount: number): Promise<(RpBulkGenerationJob & { id: string })[]> {
  if (!db) return [];
  const q = query(
    collection(db, "rp_bulk_generation_jobs"),
    orderBy("createdAt", "desc"),
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as RpBulkGenerationJob & { id: string }));
}

export function useBulkGenerationJobs(limitCount = 50) {
  const key = `rp_bulk_generation_jobs:${limitCount}`;
  const { data, error, isLoading, mutate } = useSWR(key, () => fetchBulkJobs(limitCount), {
    refreshInterval: 10000,
  });
  return {
    jobs: data || [],
    isLoading,
    error: error?.message,
    mutate,
  };
}

export interface CreateBulkGenerationJobInput {
  designIds: string[];
  blankIds: string[];
  identityIds: string[];
  imagesPerProduct?: number;
  presetId?: string;
}

export function useCreateBulkGenerationJob() {
  const createJob = useCallback(async (input: CreateBulkGenerationJobInput) => {
    if (!functions) throw new Error("Cloud Functions not initialized");
    const fn = httpsCallable(functions, "createBulkGenerationJob");
    const result = await fn({
      designIds: input.designIds,
      blankIds: input.blankIds,
      identityIds: input.identityIds,
      imagesPerProduct: input.imagesPerProduct ?? 3,
      presetId: input.presetId || undefined,
    });
    return result.data as { ok: boolean; jobId: string; total: number };
  }, []);

  return { createJob };
}

export function bulkJobStatusLabel(status: RpBulkGenerationJobStatus): string {
  const labels: Record<RpBulkGenerationJobStatus, string> = {
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
  };
  return labels[status] || status;
}

export function bulkJobStatusClass(status: RpBulkGenerationJobStatus): string {
  const classes: Record<RpBulkGenerationJobStatus, string> = {
    pending: "bg-gray-100 text-gray-800",
    running: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
}
