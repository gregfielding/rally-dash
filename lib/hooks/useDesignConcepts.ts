"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RpDesignConcept, RpConceptStatus } from "@/lib/types/firestore";

async function fetchDesignConcepts(
  productId?: string,
  briefId?: string,
  status?: RpConceptStatus
): Promise<RpDesignConcept[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_design_concepts");
  let conditions: any[] = [];

  if (productId) {
    conditions.push(where("productId", "==", productId));
  }
  if (briefId) {
    conditions.push(where("briefId", "==", briefId));
  }
  if (status) {
    conditions.push(where("status", "==", status));
  }

  conditions.push(orderBy("createdAt", "desc"));

  const q = query(base, ...conditions);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RpDesignConcept),
  }));
}

export function useDesignConcepts(options?: {
  productId?: string;
  briefId?: string;
  status?: RpConceptStatus;
}) {
  const { productId, briefId, status } = options || {};
  const cacheKey = `rp_design_concepts:${productId || "all"}:${briefId || ""}:${status || ""}`;

  const { data, error, isLoading, mutate } = useSWR<RpDesignConcept[]>(
    cacheKey,
    () => fetchDesignConcepts(productId, briefId, status),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  const updateConceptStatus = useCallback(
    async (conceptId: string, newStatus: RpConceptStatus, updatedBy: string) => {
      if (!db) throw new Error("Database not initialized");
      await updateDoc(doc(db, "rp_design_concepts", conceptId), {
        status: newStatus,
      });
      mutate();
    },
    [mutate]
  );

  return {
    concepts: data || [],
    loading: isLoading,
    error: error?.message || null,
    updateConceptStatus,
    refetch: mutate,
  };
}
