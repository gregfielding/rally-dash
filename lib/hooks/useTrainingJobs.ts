"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  collection,
  addDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RPTrainingJob, RPTrainingJobStatus } from "@/lib/types/firestore";

async function fetchTrainingJobs(
  identityId?: string
): Promise<RPTrainingJob[]> {
  if (!db) throw new Error("Database not initialized");
  let q = query(collection(db, "rp_training_jobs"), orderBy("createdAt", "desc"));
  if (identityId) {
    q = query(
      collection(db, "rp_training_jobs"),
      where("identityId", "==", identityId),
      orderBy("createdAt", "desc")
    );
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPTrainingJob) }));
}

export function useTrainingJobs(identityId?: string) {
  const { data, error, isLoading, mutate } = useSWR<RPTrainingJob[]>(
    "rp_training_jobs" + (identityId ? `:${identityId}` : ""),
    () => fetchTrainingJobs(identityId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const createTrainingJob = useCallback(
    async (
      input: Omit<
        RPTrainingJob,
        "id" | "status" | "createdAt" | "completedAt" | "falRequestId"
      >
    ) => {
      if (!db) throw new Error("Database not initialized");

      const now = serverTimestamp();
      
      // Remove undefined values - Firestore doesn't allow undefined
      const cleanedInput = Object.fromEntries(
        Object.entries(input).filter(([_, value]) => value !== undefined)
      ) as typeof input;
      
      const newJob = {
        ...cleanedInput,
        status: "queued" as RPTrainingJobStatus,
        createdAt: now,
        // Don't include startedAt or completedAt if undefined
      };

      const colRef = collection(db, "rp_training_jobs");
      const docRef = await addDoc(colRef, newJob as any);

      // Optimistic update
      const optimisticJob: RPTrainingJob = {
        ...(newJob as any),
        id: docRef.id,
      };
      mutate([optimisticJob, ...(data || [])], false);

      await mutate();
      return docRef.id;
    },
    [data, mutate]
  );

  const updateTrainingJobStatus = useCallback(
    async (id: string, status: RPTrainingJobStatus, extra?: Partial<RPTrainingJob>) => {
      if (!db) throw new Error("Database not initialized");
      const ref = doc(db, "rp_training_jobs", id);
      const updateData: Partial<RPTrainingJob> & { updatedAt: any } = {
        status,
        ...extra,
        updatedAt: serverTimestamp() as any,
      };

      // Optimistic update
      const optimisticData = (data || []).map((job) =>
        job.id === id ? { ...job, ...updateData } : job
      );
      mutate(optimisticData, false);

      await updateDoc(ref, updateData as any);
      await mutate();
    },
    [data, mutate]
  );

  return {
    jobs: data || [],
    loading: isLoading,
    error: error?.message || null,
    createTrainingJob,
    updateTrainingJobStatus,
    refetch: mutate,
  };
}


