"use client";

import useSWR from "swr";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RPLoraArtifact } from "@/lib/types/firestore";

async function fetchArtifacts(identityId?: string): Promise<RPLoraArtifact[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_lora_artifacts");
  const q = identityId
    ? query(
        base,
        where("identityId", "==", identityId),
        orderBy("createdAt", "desc")
      )
    : query(base, orderBy("createdAt", "desc"));

  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPLoraArtifact) }));
}

export function useLoraArtifacts(identityId?: string) {
  const { data, error, isLoading, mutate } = useSWR<RPLoraArtifact[]>(
    "rp_lora_artifacts" + (identityId ? `:${identityId}` : ""),
    () => fetchArtifacts(identityId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    artifacts: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}


