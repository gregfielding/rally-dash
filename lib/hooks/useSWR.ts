"use client";

import useSWR from "swr";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

// Generic Firestore fetcher for SWR
async function firestoreFetcher<T>(path: string): Promise<T[]> {
  if (!db) throw new Error("Database not initialized");
  
  const [collectionPath, ...subCollections] = path.split("/");
  let ref: ReturnType<typeof collection> = collection(db, collectionPath);
  
  // Handle subcollections (e.g., "modelPacks/packId/identities")
  for (let i = 0; i < subCollections.length; i += 2) {
    if (subCollections[i + 1]) {
      ref = collection(ref, subCollections[i], subCollections[i + 1]);
    }
  }
  
  const q = query(ref, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as T[];
}

export function useFirestoreData<T>(path: string | null) {
  const { data, error, isLoading, mutate } = useSWR<T[]>(
    path ? `firestore:${path}` : null,
    () => firestoreFetcher<T>(path!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  return {
    data: data || [],
    loading: isLoading,
    error: error?.message || null,
    mutate,
  };
}

