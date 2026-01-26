"use client";

import useSWR from "swr";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RPGeneration } from "@/lib/types/firestore";

async function fetchGenerations(identityId?: string): Promise<RPGeneration[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_generations");
  let q;
  
  try {
    if (identityId) {
      // Try with orderBy first, fall back to just where if index doesn't exist
      try {
        q = query(
          base,
          where("identityId", "==", identityId),
          orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPGeneration) }));
      } catch (orderByError: any) {
        // If orderBy fails (missing index), just use where and sort in memory
        console.warn("[useGenerations] orderBy failed, sorting in memory:", orderByError);
        q = query(base, where("identityId", "==", identityId));
        const snapshot = await getDocs(q);
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPGeneration) }));
        // Sort by createdAt in memory
        return docs.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
          return bTime - aTime;
        });
      }
    } else {
      // No identityId filter, try orderBy or just get all and sort
      try {
        q = query(base, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPGeneration) }));
      } catch (orderByError: any) {
        console.warn("[useGenerations] orderBy failed, sorting in memory:", orderByError);
        const snapshot = await getDocs(base);
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPGeneration) }));
        // Sort by createdAt in memory
        return docs.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
          return bTime - aTime;
        });
      }
    }
  } catch (error: any) {
    console.error("[useGenerations] Error fetching generations:", error);
    throw error;
  }
}

export function useGenerations(identityId?: string) {
  const { data, error, isLoading, mutate } = useSWR<RPGeneration[]>(
    "rp_generations" + (identityId ? `:${identityId}` : ""),
    () => fetchGenerations(identityId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    generations: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}


