"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { db, functions } from "@/lib/firebase/config";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import type { RpMockJob, RpMockAsset } from "@/lib/types/firestore";

// ============================================================================
// Fetchers
// ============================================================================

/**
 * Fetch mock jobs for a design/blank/view combination
 */
async function fetchMockJobs(params: {
  designId?: string;
  blankId?: string;
  view?: "front" | "back";
}): Promise<RpMockJob[]> {
  if (!db) throw new Error("Firestore not initialized");
  if (!params.designId) return [];

  let q = query(
    collection(db, "rp_mock_jobs"),
    where("designId", "==", params.designId),
    orderBy("createdAt", "desc")
  );

  // Note: Firestore requires composite indexes for multiple where clauses
  // For MVP, we filter client-side for blankId and view

  const snapshot = await getDocs(q);
  let jobs = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as RpMockJob[];

  // Client-side filtering
  if (params.blankId) {
    jobs = jobs.filter((j) => j.blankId === params.blankId);
  }
  if (params.view) {
    jobs = jobs.filter((j) => j.view === params.view);
  }

  return jobs;
}

/**
 * Fetch mock assets for a design/blank/view combination
 */
async function fetchMockAssets(params: {
  designId?: string;
  blankId?: string;
  view?: "front" | "back";
}): Promise<RpMockAsset[]> {
  if (!db) throw new Error("Firestore not initialized");
  if (!params.designId) return [];

  let q = query(
    collection(db, "rp_mock_assets"),
    where("designId", "==", params.designId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);
  let assets = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as RpMockAsset[];

  // Client-side filtering
  if (params.blankId) {
    assets = assets.filter((a) => a.blankId === params.blankId);
  }
  if (params.view) {
    assets = assets.filter((a) => a.view === params.view);
  }

  return assets;
}

// ============================================================================
// Hooks
// ============================================================================

export interface UseMockJobsFilters {
  designId?: string;
  blankId?: string;
  view?: "front" | "back";
}

/**
 * Hook to fetch mock jobs
 */
export function useMockJobs(filters: UseMockJobsFilters) {
  const key = filters.designId
    ? `mock-jobs-${filters.designId}-${filters.blankId || "all"}-${filters.view || "all"}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => fetchMockJobs(filters),
    {
      revalidateOnFocus: false,
    }
  );

  return {
    jobs: data || [],
    isLoading,
    error: error?.message,
    mutate,
  };
}

export interface UseMockAssetsFilters {
  designId?: string;
  blankId?: string;
  view?: "front" | "back";
}

/**
 * Hook to fetch mock assets
 */
export function useMockAssets(filters: UseMockAssetsFilters) {
  const key = filters.designId
    ? `mock-assets-${filters.designId}-${filters.blankId || "all"}-${filters.view || "all"}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => fetchMockAssets(filters),
    {
      revalidateOnFocus: false,
    }
  );

  return {
    assets: data || [],
    isLoading,
    error: error?.message,
    mutate,
  };
}

/**
 * Hook to watch a specific job's status in real-time
 */
export function useWatchMockJob(jobId: string | null) {
  const [job, setJob] = useState<RpMockJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !db) {
      setJob(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      doc(db, "rp_mock_jobs", jobId),
      (snapshot) => {
        if (snapshot.exists()) {
          setJob({ id: snapshot.id, ...snapshot.data() } as RpMockJob);
        } else {
          setJob(null);
        }
        setIsLoading(false);
      },
      (err) => {
        console.error("[useWatchMockJob] Error:", err);
        setError(err.message);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [jobId]);

  return { job, isLoading, error };
}

export interface CreateMockJobInput {
  designId: string;
  blankId: string;
  view: "front" | "back";
  quality: "draft" | "final";
}

/**
 * Hook to create a mock generation job
 */
export function useCreateMockJob() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createJob = async (input: CreateMockJobInput): Promise<string | null> => {
    if (!functions) {
      setError("Firebase Functions not initialized");
      return null;
    }

    setIsCreating(true);
    setError(null);

    try {
      const createMockJob = httpsCallable(functions, "createMockJob");
      const result = await createMockJob(input);
      const data = result.data as { ok: boolean; jobId: string };

      if (!data.ok) {
        throw new Error("Failed to create mock job");
      }

      // Invalidate the jobs cache
      globalMutate(
        (key) => typeof key === "string" && key.startsWith(`mock-jobs-${input.designId}`),
        undefined,
        { revalidate: true }
      );

      return data.jobId;
    } catch (err: any) {
      console.error("[useCreateMockJob] Error:", err);
      setError(err.message || "Failed to create mock job");
      return null;
    } finally {
      setIsCreating(false);
    }
  };

  return { createJob, isCreating, error };
}

/**
 * Hook to approve/unapprove a mock asset
 */
export function useApproveMockAsset() {
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approveAsset = async (
    assetId: string,
    approved: boolean,
    designId?: string
  ): Promise<boolean> => {
    if (!functions) {
      setError("Firebase Functions not initialized");
      return false;
    }

    setIsApproving(true);
    setError(null);

    try {
      const approveMockAssetFn = httpsCallable(functions, "approveMockAsset");
      const result = await approveMockAssetFn({ assetId, approved });
      const data = result.data as { ok: boolean };

      if (!data.ok) {
        throw new Error("Failed to update approval");
      }

      // Invalidate the assets cache
      if (designId) {
        globalMutate(
          (key) => typeof key === "string" && key.startsWith(`mock-assets-${designId}`),
          undefined,
          { revalidate: true }
        );
      }

      return true;
    } catch (err: any) {
      console.error("[useApproveMockAsset] Error:", err);
      setError(err.message || "Failed to update approval");
      return false;
    } finally {
      setIsApproving(false);
    }
  };

  return { approveAsset, isApproving, error };
}
