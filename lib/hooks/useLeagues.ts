"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { League } from "@/lib/types/firestore";

async function fetchLeagues(): Promise<League[]> {
  if (!db) throw new Error("Database not initialized");
      const q = query(collection(db, "leagues"), orderBy("name"));
      const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as League[];
}

export function useLeagues() {
  const { data, error, isLoading, mutate } = useSWR<League[]>(
    "leagues",
    fetchLeagues,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const createLeague = useCallback(async (league: Omit<League, "id" | "createdAt" | "updatedAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    const slug = league.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const newLeague = {
      ...league,
      slug,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    // Optimistic update
    const optimisticLeague: League = {
      ...newLeague as League,
      id: "temp",
      createdAt: undefined,
      updatedAt: undefined,
    };
    mutate([...(data || []), optimisticLeague], false);
    
    const docRef = await addDoc(collection(db, "leagues"), newLeague);
    await mutate();
    return docRef.id;
  }, [data, mutate]);

  const updateLeague = useCallback(async (id: string, updates: Partial<League>) => {
    if (!db) throw new Error("Database not initialized");
    
    const updateData: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    if (updates.name) {
      updateData.slug = updates.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    
    // Optimistic update
    const optimisticData = (data || []).map(league => 
      league.id === id ? { ...league, ...updates } : league
    );
    mutate(optimisticData, false);
    
    await updateDoc(doc(db, "leagues", id), updateData);
    await mutate();
  }, [data, mutate]);

  const deleteLeague = useCallback(async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    
    // Optimistic update
    const optimisticData = (data || []).filter(league => league.id !== id);
    mutate(optimisticData, false);
    
    await deleteDoc(doc(db, "leagues", id));
    await mutate();
  }, [data, mutate]);

  return {
    leagues: data || [],
    loading: isLoading,
    error: error?.message || null,
    createLeague,
    updateLeague,
    deleteLeague,
    refetch: mutate,
  };
}

