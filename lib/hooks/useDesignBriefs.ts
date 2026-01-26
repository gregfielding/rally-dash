"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RpDesignBrief, RpBriefStatus } from "@/lib/types/firestore";

async function fetchDesignBriefs(productId?: string): Promise<RpDesignBrief[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_design_briefs");
  let q;

  if (productId) {
    q = query(base, where("productId", "==", productId), orderBy("createdAt", "desc"));
  } else {
    q = query(base, orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RpDesignBrief),
  }));
}

export function useDesignBriefs(productId?: string) {
  const cacheKey = productId ? `rp_design_briefs:${productId}` : "rp_design_briefs:all";

  const { data, error, isLoading, mutate } = useSWR<RpDesignBrief[]>(
    cacheKey,
    () => fetchDesignBriefs(productId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  const createBrief = useCallback(
    async (
      brief: Omit<RpDesignBrief, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
      createdBy: string
    ) => {
      if (!db) throw new Error("Database not initialized");
      const newBrief = {
        ...brief,
        status: "draft" as RpBriefStatus,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy,
        updatedBy: createdBy,
      };
      await addDoc(collection(db, "rp_design_briefs"), newBrief);
      mutate();
    },
    [mutate]
  );

  const updateBrief = useCallback(
    async (briefId: string, updates: Partial<RpDesignBrief>, updatedBy: string) => {
      if (!db) throw new Error("Database not initialized");
      await updateDoc(doc(db, "rp_design_briefs", briefId), {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy,
      });
      mutate();
    },
    [mutate]
  );

  return {
    briefs: data || [],
    loading: isLoading,
    error: error?.message || null,
    createBrief,
    updateBrief,
    refetch: mutate,
  };
}
