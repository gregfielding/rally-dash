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
  DesignDoc,
  DesignTeam,
  DesignColor,
  DesignStatus,
} from "@/lib/types/firestore";

// ============================================================================
// Types
// ============================================================================

export interface UseDesignsFilters {
  teamId?: string;
  status?: DesignStatus;
  hasPng?: boolean;
  hasPdf?: boolean;
  search?: string;
}

export interface CreateDesignInput {
  name: string;
  teamId: string;
  colors: DesignColor[];
  tags?: string[];
  description?: string;
}

export interface UpdateDesignInput {
  designId: string;
  name?: string;
  status?: DesignStatus;
  colors?: DesignColor[];
  tags?: string[];
  description?: string;
  /** Taxonomy (from rp_taxonomy_*). Pass null to clear. */
  sportCode?: string | null;
  leagueCode?: string | null;
  teamCode?: string | null;
  themeCode?: string | null;
  designFamily?: string | null;
}

export interface UpdateDesignFileInput {
  designId: string;
  kind: "png" | "pdf" | "svg";
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  sha256?: string;
}

// ============================================================================
// Fetchers
// ============================================================================

async function fetchDesigns(filters: UseDesignsFilters = {}): Promise<DesignDoc[]> {
  if (!db) {
    console.warn("[useDesignAssets] Firestore not initialized");
    return [];
  }

  try {
    let q = query(collection(db, "designs"), orderBy("updatedAt", "desc"));

    // Apply filters
    if (filters.teamId) {
      q = query(q, where("teamId", "==", filters.teamId));
    }
    if (filters.status) {
      q = query(q, where("status", "==", filters.status));
    }
    if (filters.hasPng !== undefined) {
      q = query(q, where("hasPng", "==", filters.hasPng));
    }
    if (filters.hasPdf !== undefined) {
      q = query(q, where("hasPdf", "==", filters.hasPdf));
    }

    const snapshot = await getDocs(q);
    let designs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as DesignDoc[];

    // Client-side search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      designs = designs.filter(
        (d) =>
          d.name.toLowerCase().includes(searchLower) ||
          d.teamNameCache?.toLowerCase().includes(searchLower) ||
          d.tags.some((t) => t.toLowerCase().includes(searchLower)) ||
          d.searchKeywords?.some((k) => k.includes(searchLower))
      );
    }

    return designs;
  } catch (error) {
    console.error("[useDesignAssets] Error fetching designs:", error);
    return [];
  }
}

async function fetchDesignById(designId: string): Promise<DesignDoc | null> {
  if (!db || !designId) return null;

  try {
    const docRef = doc(db, "designs", designId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) return null;

    return {
      id: snapshot.id,
      ...snapshot.data(),
    } as DesignDoc;
  } catch (error) {
    console.error("[useDesignAssets] Error fetching design:", error);
    return null;
  }
}

async function fetchDesignTeams(): Promise<DesignTeam[]> {
  if (!db) {
    console.warn("[useDesignAssets] Firestore not initialized");
    return [];
  }

  try {
    const q = query(collection(db, "design_teams"), orderBy("name"));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as DesignTeam[];
  } catch (error) {
    console.error("[useDesignAssets] Error fetching teams:", error);
    return [];
  }
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching all designs with optional filters
 */
export function useDesigns(filters: UseDesignsFilters = {}) {
  const key = ["designs", JSON.stringify(filters)];

  const { data, error, isLoading, mutate } = useSWR(key, () =>
    fetchDesigns(filters)
  );

  return {
    designs: data || [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching a single design by ID
 */
export function useDesign(designId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    designId ? ["design", designId] : null,
    () => (designId ? fetchDesignById(designId) : null)
  );

  return {
    design: data,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching design teams
 */
export function useDesignTeams() {
  const { data, error, isLoading, mutate } = useSWR(
    ["design_teams"],
    fetchDesignTeams
  );

  return {
    teams: data || [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for seeding design teams
 */
export function useSeedDesignTeams() {
  const seedTeams = useCallback(async () => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useSeedDesignTeams] Seeding teams...");

    const seedFn = httpsCallable(functions, "seedDesignTeams");
    const result = await seedFn({});

    return result.data as {
      ok: boolean;
      results: Array<{ id: string; status: string; reason?: string }>;
      created: number;
      skipped: number;
      total: number;
    };
  }, []);

  return { seedTeams };
}

/**
 * Hook for creating a new design
 */
export function useCreateDesign() {
  const createDesign = useCallback(async (input: CreateDesignInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useCreateDesign] Creating design:", input.name);

    const createFn = httpsCallable(functions, "createDesignAsset");
    const result = await createFn(input);

    return result.data as {
      ok: boolean;
      designId: string;
      slug: string;
    };
  }, []);

  return { createDesign };
}

/**
 * Hook for updating a design
 */
export function useUpdateDesign() {
  const updateDesign = useCallback(async (input: UpdateDesignInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useUpdateDesign] Updating design:", input.designId);

    const updateFn = httpsCallable(functions, "updateDesignAsset");
    const result = await updateFn(input);

    return result.data as { ok: boolean };
  }, []);

  return { updateDesign };
}

/**
 * Hook for updating design file metadata
 */
export function useUpdateDesignFile() {
  const updateFile = useCallback(async (input: UpdateDesignFileInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }

    console.log("[useUpdateDesignFile] Updating file:", input.designId, input.kind);

    const updateFn = httpsCallable(functions, "updateDesignFile");
    const result = await updateFn(input);

    return result.data as { ok: boolean };
  }, []);

  return { updateFile };
}
