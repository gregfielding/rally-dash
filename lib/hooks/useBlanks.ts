"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  doc,
  getDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase/config";
import {
  RPBlank,
  RPBlankStyleCode,
  RPBlankColorName,
  RPBlankStatus,
  RPBlankGarmentCategory,
  RPImageRef,
  RPImageMeta,
} from "@/lib/types/firestore";

// Re-export types and constants from style registry
export {
  STYLE_REGISTRY,
  ALL_STYLE_CODES,
  ALL_GARMENT_CATEGORIES,
  COLOR_REGISTRY,
  buildBlankSlug,
  getAllowedColors,
  isValidStyleColor,
  getStyleInfo,
  getDefaultPlacements,
} from "@/lib/rp/blanks/styleRegistry";

export type {
  BlankStyleCode,
  BlankGarmentCategory,
  BlankColorName,
  StyleRegistryEntry,
  PlacementConfig,
} from "@/lib/rp/blanks/styleRegistry";

// ============================================
// Blanks Fetching (from rp_blanks collection)
// ============================================

export interface UseBlanksFilters {
  styleCode?: RPBlankStyleCode;
  colorName?: RPBlankColorName;
  garmentCategory?: RPBlankGarmentCategory;
  status?: RPBlankStatus;
  search?: string;
}

async function fetchBlanks(filters?: UseBlanksFilters): Promise<RPBlank[]> {
  if (!db) throw new Error("Database not initialized");

  const base = collection(db, "rp_blanks");
  const conditions: any[] = [];

  if (filters?.styleCode) {
    conditions.push(where("styleCode", "==", filters.styleCode));
  }
  if (filters?.colorName) {
    conditions.push(where("colorName", "==", filters.colorName));
  }
  if (filters?.garmentCategory) {
    conditions.push(where("garmentCategory", "==", filters.garmentCategory));
  }
  if (filters?.status) {
    conditions.push(where("status", "==", filters.status));
  }

  conditions.push(orderBy("createdAt", "desc"));

  const q = query(base, ...conditions);
  const snapshot = await getDocs(q);

  let blanks = snapshot.docs.map((d) => ({ ...d.data(), blankId: d.id } as RPBlank));

  // Client-side search filter
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    blanks = blanks.filter((b) => 
      b.slug?.toLowerCase().includes(searchLower) ||
      b.styleCode?.toLowerCase().includes(searchLower) ||
      b.styleName?.toLowerCase().includes(searchLower) ||
      b.colorName?.toLowerCase().includes(searchLower) ||
      b.garmentCategory?.toLowerCase().includes(searchLower) ||
      b.searchKeywords?.some(k => k.includes(searchLower))
    );
  }

  return blanks;
}

async function fetchBlankById(blankId: string): Promise<RPBlank | null> {
  if (!db) throw new Error("Database not initialized");
  if (!blankId) return null;

  const docRef = doc(db, "rp_blanks", blankId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  return { ...docSnap.data(), blankId: docSnap.id } as RPBlank;
}

/**
 * Hook to fetch all blanks with optional filters
 */
export function useBlanks(filters?: UseBlanksFilters) {
  const cacheKey = `rp_blanks:${JSON.stringify(filters || {})}`;

  const { data, error, isLoading, mutate } = useSWR<RPBlank[]>(
    cacheKey,
    () => fetchBlanks(filters),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    blanks: data || [],
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}

/**
 * Hook to fetch a single blank by ID
 */
export function useBlank(blankId: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<RPBlank | null>(
    blankId ? `rp_blank:${blankId}` : null,
    () => (blankId ? fetchBlankById(blankId) : null),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  return {
    blank: data || null,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
}

// ============================================
// Blank Mutations
// ============================================

export interface CreateBlankInput {
  styleCode: RPBlankStyleCode;
  colorName: RPBlankColorName;
}

export interface UpdateBlankInput {
  blankId: string;
  status?: RPBlankStatus;
  frontImage?: RPImageRef;
  backImage?: RPImageRef;
  imageMeta?: RPImageMeta;
}

/**
 * Hook for creating blanks
 */
export function useCreateBlank() {
  const createBlank = useCallback(async (input: CreateBlankInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useCreateBlank] Creating blank:", input);

    const createBlankFn = httpsCallable(functions, "createBlank");
    const result = await createBlankFn(input);

    return result.data as { ok: boolean; blankId: string; slug: string };
  }, []);

  return { createBlank };
}

/**
 * Hook for seeding all 21 blanks
 */
export function useSeedBlanks() {
  const seedBlanks = useCallback(async () => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useSeedBlanks] Seeding all blanks...");

    const seedFn = httpsCallable(functions, "seedBlanks");
    const result = await seedFn({});

    return result.data as { 
      ok: boolean; 
      results: Array<{ styleCode: string; colorName: string; slug: string; status: string; blankId?: string }>;
      created: number;
      skipped: number;
      total: number;
    };
  }, []);

  return { seedBlanks };
}

/**
 * Hook for updating blanks
 */
export function useUpdateBlank() {
  const updateBlank = useCallback(async (input: UpdateBlankInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useUpdateBlank] Updating blank:", input);

    const updateFn = httpsCallable(functions, "updateBlank");
    const result = await updateFn(input);

    return result.data as { ok: boolean };
  }, []);

  return { updateBlank };
}

/**
 * Hook for deleting blanks (archives if referenced)
 */
export function useDeleteBlank() {
  const deleteBlank = useCallback(async (blankId: string) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useDeleteBlank] Deleting blank:", blankId);

    const deleteFn = httpsCallable(functions, "deleteBlank");
    const result = await deleteFn({ blankId });

    return result.data as { ok: boolean; action: "deleted" | "archived"; reason?: string };
  }, []);

  return { deleteBlank };
}
