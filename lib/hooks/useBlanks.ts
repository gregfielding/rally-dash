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
  RPBlankGarmentSizeCode,
  RPBlankStatus,
  RPBlankGarmentCategory,
  RPBlankColorFamily,
  RPBlankShopifyDefaults,
  RPBlankDefaultPricing,
  RPBlankDefaultShipping,
  RPBlankRenderDefaults,
  RPBlankSourcing,
  RPImageRef,
  RPImageMeta,
  RPPlacement,
  RPBlankVariant,
  RPBlankEligibility,
  RPBlankDefaultPrintSides,
  RPBlankRenderProfile,
} from "@/lib/types/firestore";
import { mapRpBlankFromFirestore } from "@/lib/blanks/blankFirestore";

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
  getDefaultPrintSidesForStyleCode,
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
  styleCode?: RPBlankStyleCode | string;
  colorName?: RPBlankColorName;
  garmentCategory?: RPBlankGarmentCategory | string;
  status?: RPBlankStatus;
  search?: string;
  /** When true, only master blanks (schemaVersion 2) */
  mastersOnly?: boolean;
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
  // Note: mastersOnly is applied client-side (Firestore OR on schemaVersion is awkward)
  if (filters?.status) {
    conditions.push(where("status", "==", filters.status));
  }

  conditions.push(orderBy("createdAt", "desc"));

  const q = query(base, ...conditions);
  const snapshot = await getDocs(q);

  let blanks = snapshot.docs.map((d) =>
    mapRpBlankFromFirestore(d.id, d.data() as Record<string, unknown>)
  );

  if (filters?.mastersOnly) {
    blanks = blanks.filter((b) => b.schemaVersion === 2);
  }

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

  return mapRpBlankFromFirestore(docSnap.id, docSnap.data() as Record<string, unknown>);
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

/** Create a master blank (one per style; colors are variants). */
export interface CreateMasterBlankInput {
  masterBlank: true;
  /** Redundant flags so createBlank always recognizes master path (some clients / older deploys). */
  createMasterBlank?: true;
  schemaIntent?: "master_v2";
  styleCode: string;
  /** When true, fill styleName/category/supplier from STYLE_REGISTRY */
  useStylePreset?: boolean;
  styleName?: string;
  garmentStyle?: string;
  category?: string;
  supplier?: string;
  supplierUrl?: string | null;
}

/** Legacy: one Firestore doc per style+color */
export interface CreateLegacyBlankInput {
  masterBlank?: false;
  styleCode: RPBlankStyleCode;
  colorName: RPBlankColorName;
}

export type CreateBlankInput = CreateMasterBlankInput | CreateLegacyBlankInput;

export interface UpdateBlankInput {
  blankId: string;
  status?: RPBlankStatus;
  frontImage?: RPImageRef;
  backImage?: RPImageRef;
  imageMeta?: RPImageMeta;
  /** Set to true to remove the front image from the blank (and delete from storage). */
  clearFrontImage?: boolean;
  /** Set to true to remove the back image from the blank (and delete from storage). */
  clearBackImage?: boolean;
  // Phase 1: Blank as foundation
  colorFamily?: RPBlankColorFamily | null;
  shopifyDefaults?: RPBlankShopifyDefaults | null;
  titleTemplate?: string | null;
  descriptionTemplate?: string | null;
  tagTemplates?: string[] | null;
  defaultPricing?: RPBlankDefaultPricing | null;
  defaultShipping?: RPBlankDefaultShipping | null;
  renderDefaults?: RPBlankRenderDefaults | null;
  sourcing?: RPBlankSourcing | null;
  blankCost?: number | null;
  costCurrency?: string | null;
  placementNotes?: string | null;
  version?: number | null;
  /** Canonical placement / render zone config; single source of truth for product generation. */
  placements?: RPPlacement[] | null;
  /**
   * Per-render-target tuning; pass `null` to remove. Omit to leave unchanged.
   * Geometry stays on `placements[]`.
   */
  renderProfile?: RPBlankRenderProfile | null;
  /** Blank-level render profile readiness (not product-level). */
  renderProfileStatus?: "draft" | "approved" | null;
  renderProfileNotes?: string | null;
  supportedRenderViews?: ("front" | "back")[] | null;
  /** 8394 MVP merchandising preference (natural vs fabric-mixed preview). */
  preferredFlatLook8394?: "flat_clean" | "flat_blended" | null;
  variants?: RPBlankVariant[] | null;
  garmentStyle?: string | null;
  category?: string | null;
  garmentCategory?: RPBlankGarmentCategory | string | null;
  styleName?: string | null;
  supplier?: string | null;
  supplierUrl?: string | null;
  schemaVersion?: number | null;
  /** Team/catalog eligibility (master blank); colors live on variants only */
  eligibility?: RPBlankEligibility | null;
  /**
   * Style-level garment sizes (XS–XL phase 1). Future Shopify sync: inherited **Size** option alongside **Color**.
   */
  garmentSizes?: RPBlankGarmentSizeCode[] | null;
  /** Garment-level default for which sides receive print; omit to leave unchanged. */
  defaultPrintSides?: RPBlankDefaultPrintSides | null;
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

    return result.data as { ok: boolean; blankId: string; slug: string; schemaVersion?: number };
  }, []);

  return { createBlank };
}

/**
 * Seed master blanks (one doc per style with color variants)
 */
export function useSeedMasterBlanks() {
  const seedMasterBlanks = useCallback(async () => {
    if (!functions) throw new Error("Cloud Functions not initialized");
    const seedFn = httpsCallable(functions, "seedMasterBlanks");
    const result = await seedFn({});
    return result.data as {
      ok: boolean;
      results: Array<{ styleCode: string; slug: string; status: string; blankId?: string; variantCount?: number }>;
      created: number;
      skipped: number;
      total: number;
    };
  }, []);
  return { seedMasterBlanks };
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
 * Admin: persist `defaultPrintSides` on blanks missing it (from STYLE_REGISTRY + category fallback).
 * Default `dryRun: true`. Pass `{ dryRun: false }` to write. Pass `{ force: true }` to overwrite explicit values.
 */
export function useBackfillBlankDefaultPrintSides() {
  const backfillBlankDefaultPrintSides = useCallback(
    async (opts?: { dryRun?: boolean; force?: boolean }) => {
      if (!functions) throw new Error("Cloud Functions not initialized");
      const fn = httpsCallable(functions, "backfillBlankDefaultPrintSides");
      const result = await fn(opts ?? { dryRun: true });
      return result.data as {
        ok: boolean;
        dryRun?: boolean;
        force?: boolean;
        wouldUpdate?: number;
        updated?: number;
        sample?: Array<{ id: string; blankId: string; next: string; prev: string | null }>;
      };
    },
    []
  );
  return { backfillBlankDefaultPrintSides };
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
