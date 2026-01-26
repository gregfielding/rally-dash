"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RpGenerationJob } from "@/lib/types/firestore";

interface AnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  productId?: string;
  presetId?: string;
  status?: string;
}

interface AnalyticsData {
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  totalCost: number;
  totalEstimatedCost: number;
  averageCostPerJob: number;
  successRate: number;
  jobsByPreset: Record<string, { count: number; cost: number }>;
  jobsByStatus: Record<string, number>;
  dailyCosts: Array<{ date: string; cost: number; jobs: number }>;
  topProducts: Array<{ productId: string; productSlug?: string; jobs: number; cost: number }>;
}

async function fetchAnalytics(filters?: AnalyticsFilters): Promise<AnalyticsData> {
  if (!db) throw new Error("Database not initialized");

  let q = query(collection(db, "rp_generation_jobs"), orderBy("createdAt", "desc"));

  if (filters?.startDate) {
    q = query(q, where("createdAt", ">=", Timestamp.fromDate(filters.startDate)));
  }
  if (filters?.endDate) {
    q = query(q, where("createdAt", "<=", Timestamp.fromDate(filters.endDate)));
  }
  if (filters?.productId) {
    q = query(q, where("productId", "==", filters.productId));
  }
  if (filters?.presetId) {
    q = query(q, where("presetId", "==", filters.presetId));
  }
  if (filters?.status) {
    q = query(q, where("status", "==", filters.status));
  }

  const snapshot = await getDocs(q);
  const jobs = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as RpGenerationJob[];

  // Calculate analytics
  const totalJobs = jobs.length;
  const successfulJobs = jobs.filter((j) => j.status === "succeeded" || j.status === "completed").length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  
  const totalCost = jobs
    .filter((j) => j.actualCost !== undefined)
    .reduce((sum, j) => sum + (j.actualCost || 0), 0);
  
  const totalEstimatedCost = jobs
    .filter((j) => j.costEstimate !== undefined)
    .reduce((sum, j) => sum + (j.costEstimate || 0), 0);

  const averageCostPerJob = successfulJobs > 0 ? totalCost / successfulJobs : 0;
  const successRate = totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 0;

  // Jobs by preset
  const jobsByPreset: Record<string, { count: number; cost: number }> = {};
  jobs.forEach((job) => {
    const presetId = job.presetId || "unknown";
    if (!jobsByPreset[presetId]) {
      jobsByPreset[presetId] = { count: 0, cost: 0 };
    }
    jobsByPreset[presetId].count++;
    jobsByPreset[presetId].cost += job.actualCost || job.costEstimate || 0;
  });

  // Jobs by status
  const jobsByStatus: Record<string, number> = {};
  jobs.forEach((job) => {
    const status = job.status || "unknown";
    jobsByStatus[status] = (jobsByStatus[status] || 0) + 1;
  });

  // Daily costs (last 30 days)
  const dailyCostsMap = new Map<string, { cost: number; jobs: number }>();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  jobs
    .filter((job) => {
      if (!job.createdAt) return false;
      const jobDate = job.createdAt.toDate();
      return jobDate >= thirtyDaysAgo;
    })
    .forEach((job) => {
      if (!job.createdAt) return;
      const dateStr = job.createdAt.toDate().toISOString().split("T")[0];
      const existing = dailyCostsMap.get(dateStr) || { cost: 0, jobs: 0 };
      dailyCostsMap.set(dateStr, {
        cost: existing.cost + (job.actualCost || job.costEstimate || 0),
        jobs: existing.jobs + 1,
      });
    });

  const dailyCosts = Array.from(dailyCostsMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top products
  const productsMap = new Map<string, { productSlug?: string; jobs: number; cost: number }>();
  jobs.forEach((job) => {
    const existing = productsMap.get(job.productId) || { jobs: 0, cost: 0, productSlug: job.productSlug };
    productsMap.set(job.productId, {
      productSlug: existing.productSlug || job.productSlug,
      jobs: existing.jobs + 1,
      cost: existing.cost + (job.actualCost || job.costEstimate || 0),
    });
  });

  const topProducts = Array.from(productsMap.entries())
    .map(([productId, data]) => ({ productId, ...data }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 10);

  return {
    totalJobs,
    successfulJobs,
    failedJobs,
    totalCost,
    totalEstimatedCost,
    averageCostPerJob,
    successRate,
    jobsByPreset,
    jobsByStatus,
    dailyCosts,
    topProducts,
  };
}

export function useAnalytics(filters?: AnalyticsFilters) {
  const filterKey = useMemo(() => {
    return JSON.stringify({
      startDate: filters?.startDate?.toISOString(),
      endDate: filters?.endDate?.toISOString(),
      productId: filters?.productId,
      presetId: filters?.presetId,
      status: filters?.status,
    });
  }, [filters]);

  const { data, error, isLoading, mutate } = useSWR<AnalyticsData>(
    `analytics:${filterKey}`,
    () => fetchAnalytics(filters),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60000, // 1 minute
    }
  );

  return {
    data,
    error,
    isLoading,
    refetch: mutate,
  };
}
