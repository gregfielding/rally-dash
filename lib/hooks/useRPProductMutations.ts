"use client";

import { useCallback } from "react";
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
      await mutate("rp_products", undefined, { revalidate: true });
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
      const fn = httpsCallable(functions, "createProductVariantsFromDesignBlank");
      const result = await fn(input);
      await mutate("rp_products", undefined, { revalidate: true });
      return result.data as {
        ok: boolean;
        productId: string | null;
        slug: string | null;
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
      renderTypes?: ("flat_blended_back" | "flat_clean_front")[];
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
        urls: {
          flat_clean_back: string | null;
          flat_blended_back: string | null;
          flat_clean_front: string | null;
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

/** Queue deterministic scene job (v1: neutral_hanger). Writes `rp_scene_render_jobs`; worker processes async. */
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
