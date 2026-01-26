"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  RPDataset,
  RPDatasetStatus,
  RPDatasetType,
} from "@/lib/types/firestore";

async function fetchRPDatasets(identityId?: string): Promise<RPDataset[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_datasets");
  const q = identityId
    ? query(base, where("identityId", "==", identityId), orderBy("createdAt", "desc"))
    : query(base, orderBy("createdAt", "desc"));

  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as RPDataset) }));
}

export interface CreateRPDatasetInput {
  identityId: string;
  name: string;
  type: RPDatasetType;
  /**
   * Optional human-readable description. Stored as a best-effort extra field
   * without changing the core Firestore schema.
   */
  description?: string;
  /**
   * Optional override for target image count. If omitted, sensible defaults
   * are derived from the dataset type.
   */
  targetImageCount?: number;
}

export interface UpdateRPDatasetInput {
  name?: string;
  type?: RPDatasetType;
  description?: string | null;
  status?: RPDatasetStatus;
  targetImageCount?: number;
}

export function useRPDatasets(identityId?: string) {
  const { data, error, isLoading, mutate } = useSWR<RPDataset[]>(
    "rp_datasets" + (identityId ? `:${identityId}` : ""),
    () => fetchRPDatasets(identityId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  const createDataset = useCallback(
    async (input: CreateRPDatasetInput) => {
      if (!db) throw new Error("Database not initialized");

      const { identityId: identityIdInput, name, type, description, targetImageCount } =
        input;

      if (!identityIdInput) {
        throw new Error("identityId is required to create a dataset");
      }
      if (!name.trim()) {
        throw new Error("Dataset name is required");
      }

      const defaultTarget =
        targetImageCount ??
        (type === "face"
          ? 20
          : type === "upper_body"
          ? 30
          : type === "full_body"
          ? 30
          : 40);

      const now = serverTimestamp();

      const newDataset: Omit<RPDataset, "id"> & {
        description?: string;
      } = {
        identityId: identityIdInput,
        name: name.trim(),
        type,
        targetImageCount: defaultTarget,
        status: "draft",
        createdAt: now as any,
        updatedAt: now as any,
      };

      if (description && description.trim()) {
        newDataset.description = description.trim();
      }

      const colRef = collection(db, "rp_datasets");

      // Optimistic append
      const optimistic: RPDataset = {
        ...(newDataset as any),
        id: "temp-id",
      };
      mutate([optimistic, ...(data || [])], false);

      const docRef = await addDoc(colRef, newDataset as any);

      await mutate();
      return docRef.id;
    },
    [data, mutate]
  );

  const updateDataset = useCallback(
    async (id: string, updates: UpdateRPDatasetInput) => {
      if (!db) throw new Error("Database not initialized");
      if (!id) throw new Error("Dataset id is required");

      const ref = doc(db, "rp_datasets", id);

      const updateData: Partial<RPDataset> & { updatedAt: any } = {
        ...(updates as any),
        updatedAt: serverTimestamp() as any,
      };

      // Clean out explicit null description if needed
      if (updates.description === null) {
        delete (updateData as any).description;
      }

      const optimistic = (data || []).map((ds) =>
        ds.id === id ? { ...ds, ...(updates as any) } : ds
      );
      mutate(optimistic, false);

      await updateDoc(ref, updateData as any);
      await mutate();
    },
    [data, mutate]
  );

  const deleteDataset = useCallback(
    async (id: string) => {
      if (!db) throw new Error("Database not initialized");
      if (!id) throw new Error("Dataset id is required");

      const ref = doc(db, "rp_datasets", id);

      const optimistic = (data || []).filter((ds) => ds.id !== id);
      mutate(optimistic, false);

      await deleteDoc(ref);
      await mutate();
    },
    [data, mutate]
  );

  const datasets = data || [];

  const datasetMapById = useMemo(() => {
    const map = new Map<string, RPDataset>();
    for (const ds of datasets) {
      if (ds.id) {
        map.set(ds.id, ds);
      }
    }
    return map;
  }, [datasets]);

  return {
    datasets,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
    createDataset,
    updateDataset,
    deleteDataset,
    datasetMapById,
  };
}

export function useRPDataset(datasetId?: string) {
  const { datasets, loading, error, refetch, datasetMapById } = useRPDatasets();

  const dataset = useMemo(
    () => (datasetId ? datasetMapById.get(datasetId) || null : null),
    [datasetId, datasetMapById]
  );

  return {
    dataset,
    loading,
    error,
    refetch,
  };
}

export function useCreateDataset(identityId?: string) {
  const { createDataset } = useRPDatasets(identityId);
  return { createDataset };
}


