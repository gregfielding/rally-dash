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
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase/config";
import {
  DesignDoc,
  DesignTeam,
  DesignColor,
  DesignStatus,
  DesignDesignType,
  type DesignThemeValue,
} from "@/lib/types/firestore";
import type { DesignFileKind } from "@/lib/designs/designAssetKinds";

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
  designType: DesignDesignType;
  /** Optional campaign / grouping (snake_case; normalized server-side too) */
  designSeries?: string | null;
  colors: DesignColor[];
  /** Internal-only */
  internalNotes?: string;
  /** @deprecated */
  tags?: string[];
  /** @deprecated use internalNotes */
  description?: string;
  /** Bulk upload: hyphenated identity slug (e.g. mlb-san-francisco-giants-city-69) */
  slugOverride?: string | null;
  importKey?: string | null;
  sportCode?: string | null;
  leagueCode?: string | null;
  teamCode?: string | null;
  themeCode?: string | null;
  designFamily?: string | null;
  importSource?: string | null;
  importBatchId?: string | null;
  importVersion?: string | null;
}

export interface UpdateDesignInput {
  designId: string;
  name?: string;
  slug?: string | null;
  status?: DesignStatus;
  colors?: DesignColor[];
  tags?: string[];
  description?: string;
  internalNotes?: string | null;
  designType?: DesignThemeValue | null;
  leagueId?: string | null;
  /** Taxonomy (from rp_taxonomy_*). Pass null to clear. */
  sportCode?: string | null;
  leagueCode?: string | null;
  teamCode?: string | null;
  themeCode?: string | null;
  designFamily?: string | null;
  /** Optional campaign / grouping (snake_case); null clears */
  designSeries?: string | null;
  /**
   * Which garment sides this artwork applies to. `null` clears the field (default: infer from placement defaults / legacy both).
   */
  supportedSides?: string[] | null;
}

export interface UpdateDesignFileInput {
  designId: string;
  kind: DesignFileKind;
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
          (d.leagueId && String(d.leagueId).toLowerCase().includes(searchLower)) ||
          (d.teamCityCache && String(d.teamCityCache).toLowerCase().includes(searchLower)) ||
          (d.teamStateCache && String(d.teamStateCache).toLowerCase().includes(searchLower)) ||
          (d.teamNicknameCache && String(d.teamNicknameCache).toLowerCase().includes(searchLower)) ||
          (d.designType && String(d.designType).toLowerCase().includes(searchLower)) ||
          (d.designSeries && String(d.designSeries).toLowerCase().includes(searchLower)) ||
          d.searchKeywords?.some((k) => k.includes(searchLower)) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(searchLower))
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
 * Callable `seedDesignTeams` (legacy sample MLB + extras). No longer exposed in the Designs UI — use
 * `functions/scripts/seed-design-teams-phase1.js` for canonical Phase 1 data. Kept for scripts or one-off admin use.
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

/** Temp upload descriptor for `parseBulkDesignUploadPreview` (matches Functions input). */
export interface BulkDesignImportTempFileDescriptor {
  originalFilename: string;
  storagePath: string;
  ext: string;
  size: number;
  contentType?: string;
}

export interface ParseBulkDesignUploadPreviewInput {
  jobId: string;
  files: BulkDesignImportTempFileDescriptor[];
  options?: {
    requirePng?: boolean;
    allowLegacyFilenames?: boolean;
  };
}

export interface CommitBulkDesignUploadItemDecision {
  itemId: string;
  action: "create" | "update" | "skip" | "blocked";
  overwriteAllowed?: boolean;
  name?: string;
  teamId?: string;
  themeCode?: string;
  designSeries?: string | null;
  slug?: string;
  /**
   * Operator's per-design blank-picker selection. Empty array or undefined
   * falls back to the server's defaultTargetBlankIds (pipeline-ready blanks).
   */
  targetBlankIds?: string[];
}

export interface CommitBulkDesignUploadInput {
  jobId: string;
  items: CommitBulkDesignUploadItemDecision[];
  /**
   * "with_products" (default) lets onDesignCreated auto-launch products via
   * each item's targetBlankIds. "library" stamps `skipAutoLaunch:true` on
   * every newly-created design so the trigger no-ops — files land in the
   * library but no rp_products are created. Operators can call
   * launchProductsFromDesign manually later.
   */
  commitMode?: "with_products" | "library";
}

/**
 * Server-owned bulk design import: preview (parse, group, match, write job/items).
 */
export function useParseBulkDesignUploadPreview() {
  const parsePreview = useCallback(async (input: ParseBulkDesignUploadPreviewInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }
    const fn = httpsCallable(functions, "parseBulkDesignUploadPreview");
    const result = await fn(input);
    return result.data as {
      ok: boolean;
      jobId: string;
      items: Record<string, unknown>[];
      parseFailures: { name: string; message: string }[];
      ignored: { name: string; reason: string }[];
      job: Record<string, unknown>;
    };
  }, []);

  return { parsePreview };
}

/**
 * Server-owned bulk design import: commit (copy temp → designs/, create/update docs).
 */
export function useCommitBulkDesignUpload() {
  const commitBulkImport = useCallback(async (input: CommitBulkDesignUploadInput) => {
    if (!functions) {
      throw new Error("Cloud Functions not initialized");
    }
    const fn = httpsCallable(functions, "commitBulkDesignUpload");
    const result = await fn(input);
    return result.data as {
      ok: boolean;
      jobId: string;
      status: string;
      results: Array<{
        itemId: string;
        resultStatus: string;
        resultDesignId?: string | null;
        resultError?: string | null;
        note?: string;
      }>;
      summary: {
        created: number;
        updated: number;
        skipped: number;
        blocked: number;
        failed: number;
      };
    };
  }, []);

  return { commitBulkImport };
}

const FIRESTORE_BATCH_MAX = 450;

/**
 * Deletes `designs/{designId}` and all `links` subdocuments.
 * Audit `logs/*` subdocs are not client-deletable per rules and may remain as orphans under the old path.
 * Storage objects under `designs/...` are not removed here.
 */
export function useDeleteDesign() {
  const deleteDesign = useCallback(async (designId: string) => {
    if (!db) {
      throw new Error("Firestore not initialized");
    }
    if (!designId?.trim()) {
      throw new Error("designId is required");
    }

    const linksSnap = await getDocs(collection(db, "designs", designId, "links"));
    const linkDocs = linksSnap.docs;
    for (let i = 0; i < linkDocs.length; i += FIRESTORE_BATCH_MAX) {
      const chunk = linkDocs.slice(i, i + FIRESTORE_BATCH_MAX);
      const batch = writeBatch(db);
      for (const d of chunk) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }

    await deleteDoc(doc(db, "designs", designId));
  }, []);

  return { deleteDesign };
}
