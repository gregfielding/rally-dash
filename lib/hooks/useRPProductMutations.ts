"use client";

import { useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/config";
import { useSWRConfig } from "swr";
import {
  RpProductCategory,
  RpProductStatus,
} from "@/lib/types/firestore";

export interface CreateProductInput {
  name: string;
  description?: string;
  category: RpProductCategory;
  baseProductKey: string;
  colorway: {
    name: string;
    hex?: string;
  };
  supplier?: {
    supplierName?: string;
    supplierSku?: string;
    styleCode?: string;
  };
  blankId?: string; // Reference to rp_blanks - physical garment template
  ai?: {
    productArtifactId?: string;
    productTrigger?: string;
    productRecommendedScale?: number;
    blankTemplateId?: string; // Deprecated: use blankId instead
  };
  tags?: string[];
}

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
 * Hook for creating products
 */
export function useCreateProduct() {
  const { mutate } = useSWRConfig();

  const createProduct = useCallback(
    async (input: CreateProductInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useCreateProduct] Creating product:", input);

      const createProductFn = httpsCallable(functions, "createProduct");
      const result = await createProductFn(input);

      // Invalidate products cache
      await mutate("rp_products", undefined, { revalidate: true });

      return result.data as { ok: boolean; productId: string; slug: string };
    },
    [mutate]
  );

  return { createProduct };
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
