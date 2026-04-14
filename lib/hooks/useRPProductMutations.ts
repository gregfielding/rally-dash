"use client";

import { useCallback } from "react";
import { getApp } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/config";
import { useSWRConfig } from "swr";
import { RpProductStatus } from "@/lib/types/firestore";

export interface GenerateProductAssetsInput {
  productId: string;
  designId?: string;
  generationType?: "product_only" | "on_model"; // Defaults to "on_model" for backward compatibility
  identityId?: string; // Required for on_model, not allowed for product_only
  presetId: string;
  artifacts?: {
    faceArtifactId?: string;
    faceScale?: number;
    bodyArtifactId?: string;
    bodyScale?: number;
    productArtifactId?: string;
    productScale?: number;
  };
  promptOverrides?: {
    prompt?: string;
    negativePrompt?: string;
    sceneNotes?: string;
  };
  imageCount?: number;
  imageSize?: "square" | "portrait" | "landscape";
  seed?: number;
  experimentId?: string;
  variantId?: string;
}

/**
 * Create a product from Design + Blank, then optionally trigger mockup generation.
 * Returns { productId, slug } so caller can call createMockJob with productId.
 */
export function useCreateProductFromDesignBlank() {
  const { mutate } = useSWRConfig();

  const createProductFromDesignBlank = useCallback(
    async (input: { designId: string; blankId: string; blankVariantId?: string | null }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "createProductFromDesignBlank");
      const result = await fn(input);
      // SWR keys are `rp_products:${JSON.stringify(filters)}` and `rp_product:${slug}` — not the bare string `rp_products`.
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as {
        ok: boolean;
        productId: string;
        slug: string;
        variantId?: string;
        variantIds?: string[];
      };
    },
    [mutate]
  );

  return { createProductFromDesignBlank };
}

/** Client-side timeout for multi-color variant creation (default SDK timeout is 70s). */
const CREATE_VARIANTS_CALLABLE_TIMEOUT_MS = 180000;

function logTeamProductGen(stage: string, payload: Record<string, unknown>) {
  console.info(
    `[TEAM_PRODUCT_GEN:UI:CALLABLE] ${stage}`,
    JSON.stringify({ ...payload, t: new Date().toISOString() })
  );
}

function logCallableError(context: string, err: unknown) {
  const e = err as { code?: string; message?: string; details?: unknown };
  logTeamProductGen("ERROR", {
    context,
    code: e?.code ?? null,
    message: e?.message ?? String(err),
    details: e?.details ?? null,
  });
}

/**
 * One Cloud Function call: parent + many variants (team catalog / bulk color adds).
 * Prefer over looping `createProductFromDesignBlank` so the parent is created once server-side.
 */
export function useCreateProductVariantsFromDesignBlank() {
  const { mutate } = useSWRConfig();

  const createProductVariantsFromDesignBlank = useCallback(
    async (input: { designId: string; blankId: string; blankVariantIds: string[] }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      let projectId: string | null = null;
      try {
        projectId = getApp().options.projectId ?? null;
      } catch {
        projectId = null;
      }
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      logTeamProductGen("REQUEST", {
        projectId,
        region: functions.region,
        name: "createProductVariantsFromDesignBlank",
        timeoutMs: CREATE_VARIANTS_CALLABLE_TIMEOUT_MS,
        designId: input.designId,
        blankId: input.blankId,
        blankVariantIds: input.blankVariantIds,
        variantCount: input.blankVariantIds.length,
      });
      const fn = httpsCallable(functions, "createProductVariantsFromDesignBlank", {
        timeout: CREATE_VARIANTS_CALLABLE_TIMEOUT_MS,
      });
      let result;
      try {
        result = await fn(input);
      } catch (err) {
        logCallableError("createProductVariantsFromDesignBlank", err);
        throw err;
      }
      const elapsedMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      const data = result.data as {
        ok?: boolean;
        parentProductId?: string | null;
        createdColorCount?: number;
        variantSubdocCountVerified?: number | null;
      };
      logTeamProductGen("RESPONSE", {
        projectId,
        elapsedMs: Math.round(elapsedMs),
        ok: data?.ok !== false,
        parentProductId: data?.parentProductId ?? null,
        createdColorCount: data?.createdColorCount ?? null,
        variantSubdocCountVerified: data?.variantSubdocCountVerified ?? null,
      });
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as {
        ok: boolean;
        productId: string | null;
        slug: string | null;
        /** Echoed for runtime proof — compare to `[TEAM_PRODUCT_GEN:SERVER:FIRESTORE_VERIFY]`. */
        parentProductId: string | null;
        createdColorCount: number;
        createdSkuCount: number;
        variantSubdocCountVerified: number | null;
        assetsBatchId?: string | null;
        assetsStatus?: string | null;
        queuedColorCount?: number | null;
        queuedRoleCount?: number | null;
        assetBatch?: {
          ok?: boolean;
          assetsBatchId?: string;
          assetsStatus?: string;
          queuedColorCount?: number;
          queuedRoleCount?: number;
          code?: string;
          skipped?: boolean;
        } | null;
        results: Array<{
          blankVariantId: string;
          variantFirestoreId?: string;
          variantFirestoreIds?: string[];
          productId?: string | null;
          slug?: string | null;
          created?: boolean;
          skipped?: boolean;
          message?: string;
        }>;
        errors?: Array<{ blankVariantId: string; message: string }>;
      };
    },
    [mutate]
  );

  return { createProductVariantsFromDesignBlank };
}

/** One-click launch: variants + metadata defaults + asset batch + `launchStatus` (use for Generate Products). */
export function useLaunchProductsFromDesign() {
  const { mutate } = useSWRConfig();

  const launchProductsFromDesign = useCallback(
    async (input: {
      designId: string;
      blankId: string;
      blankVariantIds: string[];
      forceAssetBatch?: boolean;
      autoSyncShopify?: boolean;
    }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "launchProductsFromDesign", {
        timeout: CREATE_VARIANTS_CALLABLE_TIMEOUT_MS,
      });
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as {
        ok: boolean;
        productId: string | null;
        slug: string | null;
        parentProductId: string | null;
        createdColorCount: number;
        createdSkuCount: number;
        variantSubdocCountVerified: number | null;
        assetsBatchId?: string | null;
        assetsStatus?: string | null;
        launchMode?: boolean;
        autoSyncShopify?: boolean;
        assetBatch?: Record<string, unknown> | null;
        results: Array<{
          blankVariantId: string;
          variantFirestoreId?: string;
          variantFirestoreIds?: string[];
          productId?: string | null;
          slug?: string | null;
          created?: boolean;
          skipped?: boolean;
          message?: string;
        }>;
        errors?: Array<{ blankVariantId: string; message: string }>;
      };
    },
    [mutate]
  );

  return { launchProductsFromDesign };
}

/** Bulk review gate + Shopify sync + asset retry (callable limits: 100 / 50 / 25 ids). */
export function useBulkProductOps() {
  const { mutate } = useSWRConfig();

  const invalidateProducts = useCallback(async () => {
    await mutate(
      (key) => typeof key === "string" && key.startsWith("rp_product"),
      undefined,
      { revalidate: true }
    );
  }, [mutate]);

  const bulkMarkProductsReviewed = useCallback(
    async (input: { productIds: string[]; action: "approve" | "hold" }) => {
      if (!functions) throw new Error("Cloud Functions not initialized");
      const fn = httpsCallable(functions, "bulkMarkProductsReviewed");
      const result = await fn(input);
      await invalidateProducts();
      return result.data as {
        ok: boolean;
        results: Array<{
          productId: string;
          ok: boolean;
          reason?: string;
          launchStatus?: string | null;
        }>;
      };
    },
    [invalidateProducts]
  );

  const bulkSyncProductsToShopify = useCallback(
    async (input: { productIds: string[] }) => {
      if (!functions) throw new Error("Cloud Functions not initialized");
      const fn = httpsCallable(functions, "bulkSyncProductsToShopify");
      const result = await fn(input);
      await invalidateProducts();
      return result.data as {
        ok: boolean;
        jobIds?: string[];
        results: Array<{
          productId: string;
          ok: boolean;
          reason?: string;
          jobId?: string;
          launchStatus?: string | null;
        }>;
      };
    },
    [invalidateProducts]
  );

  const bulkRetryProductAssets = useCallback(
    async (input: { productIds: string[] }) => {
      if (!functions) throw new Error("Cloud Functions not initialized");
      const fn = httpsCallable(functions, "bulkRetryProductAssets", {
        timeout: CREATE_VARIANTS_CALLABLE_TIMEOUT_MS,
      });
      const result = await fn(input);
      await invalidateProducts();
      return result.data as {
        ok: boolean;
        results: Array<{ productId: string; ok: boolean; error?: string; detail?: unknown }>;
      };
    },
    [invalidateProducts]
  );

  return { bulkMarkProductsReviewed, bulkSyncProductsToShopify, bulkRetryProductAssets };
}

/** Re-run server-side merchandising resolution (same as create) for an existing product. */
export function useRefreshProductMerchandisingFromSources() {
  const { mutate } = useSWRConfig();

  const refreshProductMerchandisingFromSources = useCallback(
    async (input: { productId: string }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "refreshProductMerchandisingFromSources");
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as { ok: boolean; productId: string; slug: string };
    },
    [mutate]
  );

  return { refreshProductMerchandisingFromSources };
}

/**
 * Hook for generating product assets
 */
export function useGenerateProductAssets() {
  const { mutate } = useSWRConfig();

  const generateProductAssets = useCallback(
    async (input: GenerateProductAssetsInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useGenerateProductAssets] Creating generation job:", input);

      const generateFn = httpsCallable(functions, "generateProductAssets");
      const result = await generateFn(input);

      // Invalidate caches
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_generation_jobs"),
        undefined,
        { revalidate: true }
      );
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product_assets"),
        undefined,
        { revalidate: true }
      );

      return result.data as { ok: boolean; jobId: string };
    },
    [mutate]
  );

  return { generateProductAssets };
}

/**
 * Step 10 MVP: explicit flat_clean + flat_blended back renders (8394 only; server-enforced).
 */
export function useGenerateProductFlatRenders() {
  const { mutate } = useSWRConfig();

  const generateProductFlatRenders = useCallback(
    async (input: {
      productId: string;
      productVariantId?: string | null;
      renderTypes?: (
        | "flat_blended_back"
        | "flat_clean_front"
        | "model_blended_back"
        | "model_clean_front"
      )[];
    }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "generateProductFlatRenders");
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as {
        ok: boolean;
        productId: string;
        inputFingerprint: string;
        renderTypes?: string[];
        /** QA: why each target was included or skipped (8394 auto-expand or explicit). */
        renderSelectionLog?: string[];
        urls: {
          flat_clean_back: string | null;
          flat_blended_back: string | null;
          flat_clean_front: string | null;
          flat_blended_front: string | null;
          model_clean_back: string | null;
          model_blended_back: string | null;
          model_clean_front: string | null;
          model_blended_front: string | null;
        };
      };
    },
    [mutate]
  );

  return { generateProductFlatRenders };
}

/**
 * MVP: composite flat_blended into hanger scene template (non-AI). Requires function env for background URL.
 */
export function useGenerateProductSceneRender() {
  const { mutate } = useSWRConfig();

  const generateProductSceneRender = useCallback(
    async (input: { productId: string; sceneKey?: string }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "generateProductSceneRender");
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as {
        ok: boolean;
        productId: string;
        sceneKey: string;
        url: string;
        sourceFlatView: "front" | "back";
      };
    },
    [mutate]
  );

  return { generateProductSceneRender };
}

/** Re-queue 8394 back mock or re-run flat renders for a color variant (server-side pipeline). */
export function useRetryVariant8394Assets() {
  const { mutate } = useSWRConfig();

  const retryVariant8394Assets = useCallback(
    async (input: { productId: string; variantId: string }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "retryVariant8394Assets");
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as { ok: boolean; skipped?: boolean; reason?: string; requeued?: string; reran?: string };
    },
    [mutate]
  );

  return { retryVariant8394Assets };
}

/** Queue deterministic scene job (neutral_hanger, backdrop_neutral, body_model, flatlay_wood, flatlay_boutique, …). Writes `rp_scene_render_jobs`. */
export function useCreateSceneRenderJob() {
  const { mutate } = useSWRConfig();

  const createSceneRenderJob = useCallback(
    async (input: { productId: string; productVariantId: string; sceneKey?: string }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "createSceneRenderJob");
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as { ok: boolean; jobId: string };
    },
    [mutate]
  );

  return { createSceneRenderJob };
}

/** Update merchandising approval on a scene row in `rp_product_assets` (+ variant cache). */
export function useUpdateSceneAssetApproval() {
  const { mutate } = useSWRConfig();

  const updateSceneAssetApproval = useCallback(
    async (input: {
      assetId: string;
      approvalState: "approved" | "rejected" | "pending_review" | "auto_approved" | "needs_review";
    }) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }
      const fn = httpsCallable(functions, "updateSceneAssetApproval");
      const result = await fn(input);
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product"),
        undefined,
        { revalidate: true }
      );
      return result.data as { ok: boolean };
    },
    [mutate]
  );

  return { updateSceneAssetApproval };
}
