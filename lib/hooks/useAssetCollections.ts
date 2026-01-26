"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { RpAssetCollection } from "@/lib/types/firestore";
import { useAuth } from "@/lib/providers/AuthProvider";

async function fetchAssetCollections(): Promise<RpAssetCollection[]> {
  if (!db) throw new Error("Database not initialized");
  const q = query(collection(db, "rp_asset_collections"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RpAssetCollection) }));
}

export function useAssetCollections() {
  const { data, error, isLoading, mutate } = useSWR<RpAssetCollection[]>(
    "rp_asset_collections",
    fetchAssetCollections,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const { user } = useAuth();

  const createCollection = useCallback(
    async (name: string, description?: string, tags?: string[]) => {
      if (!db) throw new Error("Database not initialized");
      if (!user) throw new Error("User must be authenticated");

      const now = serverTimestamp() as any;
      const newCollection: Omit<RpAssetCollection, "id"> = {
        name,
        description,
        tags: tags || [],
        assetIds: [],
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid,
        updatedBy: user.uid,
      };

      const docRef = await addDoc(collection(db, "rp_asset_collections"), newCollection);
      await mutate();
      return docRef.id;
    },
    [user, mutate]
  );

  const updateCollection = useCallback(
    async (collectionId: string, updates: Partial<RpAssetCollection>) => {
      if (!db) throw new Error("Database not initialized");
      if (!user) throw new Error("User must be authenticated");

      const collectionRef = doc(db, "rp_asset_collections", collectionId);
      await updateDoc(collectionRef, {
        ...updates,
        updatedAt: serverTimestamp() as any,
        updatedBy: user.uid,
      });
      await mutate();
    },
    [user, mutate]
  );

  const deleteCollection = useCallback(
    async (collectionId: string) => {
      if (!db) throw new Error("Database not initialized");
      await deleteDoc(doc(db, "rp_asset_collections", collectionId));
      await mutate();
    },
    [mutate]
  );

  const addAssetsToCollection = useCallback(
    async (collectionId: string, assetIds: string[]) => {
      if (!db) throw new Error("Database not initialized");
      if (!user) throw new Error("User must be authenticated");

      const collectionRef = doc(db, "rp_asset_collections", collectionId);
      const collectionSnap = await getDoc(collectionRef);
      const currentData = collectionSnap.exists() ? (collectionSnap.data() as RpAssetCollection) : undefined;
      const currentAssetIds = currentData?.assetIds || [];
      const newAssetIds = [...new Set([...currentAssetIds, ...assetIds])];

      await updateDoc(collectionRef, {
        assetIds: newAssetIds,
        updatedAt: serverTimestamp() as any,
        updatedBy: user.uid,
      });

      // Also update assets to include collectionId
      const batch = writeBatch(db);
      for (const assetId of assetIds) {
        const assetRef = doc(db, "rp_product_assets", assetId);
        const assetSnap = await getDoc(assetRef);
        if (assetSnap.exists()) {
          const assetData = assetSnap.data();
          const currentCollectionIds = assetData.collectionIds || [];
          if (!currentCollectionIds.includes(collectionId)) {
            batch.update(assetRef, {
              collectionIds: [...currentCollectionIds, collectionId],
              updatedAt: serverTimestamp() as any,
            });
          }
        }
      }
      await batch.commit();

      await mutate();
    },
    [user, mutate]
  );

  const removeAssetsFromCollection = useCallback(
    async (collectionId: string, assetIds: string[]) => {
      if (!db) throw new Error("Database not initialized");
      if (!user) throw new Error("User must be authenticated");

      const collectionRef = doc(db, "rp_asset_collections", collectionId);
      const collectionSnap = await getDoc(collectionRef);
      const currentData = collectionSnap.exists() ? (collectionSnap.data() as RpAssetCollection) : undefined;
      const currentAssetIds = currentData?.assetIds || [];
      const newAssetIds = currentAssetIds.filter((id) => !assetIds.includes(id));

      await updateDoc(collectionRef, {
        assetIds: newAssetIds,
        updatedAt: serverTimestamp() as any,
        updatedBy: user.uid,
      });
      await mutate();
    },
    [user, mutate]
  );

  return {
    collections: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
    createCollection,
    updateCollection,
    deleteCollection,
    addAssetsToCollection,
    removeAssetsFromCollection,
  };
}
