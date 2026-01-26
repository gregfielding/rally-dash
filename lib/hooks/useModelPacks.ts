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
import { ModelPack } from "@/lib/types/firestore";

async function fetchModelPacks(): Promise<ModelPack[]> {
  if (!db) throw new Error("Database not initialized");
  const q = query(collection(db, "modelPacks"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as ModelPack[];
}

export function useModelPacks() {
  const { data, error, isLoading, mutate } = useSWR<ModelPack[]>(
    "modelPacks",
    fetchModelPacks,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const createPack = useCallback(async (pack: Omit<ModelPack, "id" | "createdAt" | "updatedAt">) => {
    if (!db) throw new Error("Database not initialized");
    
    // Remove any undefined values (Firestore doesn't accept undefined)
    const cleanPack: any = {};
    Object.keys(pack).forEach(key => {
      const value = (pack as any)[key];
      if (value !== undefined) {
        cleanPack[key] = value;
      }
    });
    
    const newPack = {
      ...cleanPack,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    // Optimistic update
    const optimisticPack = {
      ...newPack,
      id: "temp",
    } as ModelPack;
    mutate([...(data || []), optimisticPack], false);
    
    const docRef = await addDoc(collection(db, "modelPacks"), newPack);
    await mutate();
    return docRef.id;
  }, [data, mutate]);

  const updatePack = useCallback(async (id: string, updates: Partial<ModelPack>) => {
    if (!db) throw new Error("Database not initialized");
    
    const updateData: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    // Optimistic update
    const optimisticData = (data || []).map(pack => 
      pack.id === id ? { ...pack, ...updates } : pack
    );
    mutate(optimisticData, false);
    
    await updateDoc(doc(db, "modelPacks", id), updateData);
    await mutate();
  }, [data, mutate]);

  const deletePack = useCallback(async (id: string) => {
    if (!db) throw new Error("Database not initialized");
    
    // Optimistic update
    const optimisticData = (data || []).filter(pack => pack.id !== id);
    mutate(optimisticData, false);
    
    await deleteDoc(doc(db, "modelPacks", id));
    await mutate();
  }, [data, mutate]);

  return {
    packs: data || [],
    loading: isLoading,
    error: error?.message || null,
    createPack,
    updatePack,
    deletePack,
    refetch: mutate,
  };
}

