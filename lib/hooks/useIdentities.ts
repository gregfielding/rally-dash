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
  where,
  serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { ModelPackIdentity } from "@/lib/types/firestore";

async function fetchIdentities(packId: string): Promise<ModelPackIdentity[]> {
  if (!db) throw new Error("Database not initialized");
  const q = query(
    collection(db, "modelPacks", packId, "identities"), 
    orderBy("name")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    packId,
    ...doc.data(),
  })) as ModelPackIdentity[];
}

export function useIdentities(packId?: string) {
  const { data, error, isLoading, mutate } = useSWR<ModelPackIdentity[]>(
    packId ? `identities:${packId}` : null,
    () => fetchIdentities(packId!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const createIdentity = useCallback(async (identity: Omit<ModelPackIdentity, "id" | "createdAt" | "updatedAt">) => {
    if (!db || !packId) throw new Error("Database or packId not initialized");
    
    // Calculate status based on facesCount
    const facesTarget = 20;
    const calculatedStatus = 
      identity.faceImageCount >= facesTarget && identity.name && identity.token
        ? "faces_complete"
        : "draft";
    
    const newIdentity = {
      ...identity,
      faceImageCount: identity.faceImageCount || 0,
      status: calculatedStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    // Optimistic update
    const optimisticIdentity = {
      ...newIdentity,
      id: "temp",
    } as ModelPackIdentity;
    mutate([...(data || []), optimisticIdentity], false);
    
    const docRef = await addDoc(collection(db, "modelPacks", packId, "identities"), newIdentity);
    await mutate();
    return docRef.id;
  }, [data, mutate, packId]);

  const updateIdentity = useCallback(async (id: string, updates: Partial<ModelPackIdentity>) => {
    if (!db || !packId) throw new Error("Database or packId not initialized");
    
    // Recalculate status if faceImageCount changed
    const currentIdentity = (data || []).find(i => i.id === id);
    if (currentIdentity && updates.faceImageCount !== undefined) {
      const facesTarget = 20;
      updates.status = 
        updates.faceImageCount >= facesTarget && currentIdentity.name && currentIdentity.token
          ? "faces_complete"
          : "draft";
    }
    
    const updateData: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    // Optimistic update
    const optimisticData = (data || []).map(identity => 
      identity.id === id ? { ...identity, ...updates } : identity
    );
    mutate(optimisticData, false);
    
    await updateDoc(doc(db, "modelPacks", packId, "identities", id), updateData);
    await mutate();
  }, [data, mutate, packId]);

  const deleteIdentity = useCallback(async (id: string) => {
    if (!db || !packId) throw new Error("Database or packId not initialized");
    
    // Optimistic update
    const optimisticData = (data || []).filter(identity => identity.id !== id);
    mutate(optimisticData, false);
    
    await deleteDoc(doc(db, "modelPacks", packId, "identities", id));
    await mutate();
  }, [data, mutate, packId]);

  return {
    identities: data || [],
    loading: isLoading,
    error: error?.message || null,
    createIdentity,
    updateIdentity,
    deleteIdentity,
    refetch: mutate,
  };
}

