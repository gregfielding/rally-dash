"use client";

import { useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/config";
import { useSWRConfig } from "swr";
import {
  RpInspirationSource,
  RpProductCategory,
} from "@/lib/types/firestore";

export interface CreateInspirationInput {
  title: string;
  description?: string;
  sourceType: RpInspirationSource;
  sourceUrl?: string;
  category?: RpProductCategory;
  tags: string[];
  licenseNote?: string;
  images: File[] | Array<{ data: string; filename: string }>; // Files or base64 data
}

export interface AttachInspirationInput {
  inspirationIds: string[];
}

/**
 * Hook for creating inspirations
 */
export function useCreateInspiration() {
  const { mutate } = useSWRConfig();

  const createInspiration = useCallback(
    async (input: CreateInspirationInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useCreateInspiration] Creating inspiration:", input.title);

      const createInspirationFn = httpsCallable(functions, "createInspiration");
      const result = await createInspirationFn(input);

      // Invalidate inspirations cache
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_inspirations"),
        undefined,
        { revalidate: true }
      );

      return result.data as { ok: boolean; inspirationId: string; imageUrls: string[] };
    },
    [mutate]
  );

  return { createInspiration };
}

/**
 * Hook for attaching inspirations to a product
 */
export function useAttachInspirationToProduct() {
  const { mutate } = useSWRConfig();

  const attachInspirationToProduct = useCallback(
    async (productId: string, input: AttachInspirationInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useAttachInspirationToProduct] Attaching to product:", productId);

      const attachFn = httpsCallable(functions, "attachInspirationToProduct");
      const result = await attachFn({ productId, ...input });

      // Invalidate product cache
      await mutate(
        (key) => typeof key === "string" && key.includes(`rp_products:${productId}`),
        undefined,
        { revalidate: true }
      );

      return result.data as { ok: boolean };
    },
    [mutate]
  );

  return { attachInspirationToProduct };
}

/**
 * Hook for attaching inspirations to a design brief
 */
export function useAttachInspirationToBrief() {
  const { mutate } = useSWRConfig();

  const attachInspirationToBrief = useCallback(
    async (briefId: string, input: AttachInspirationInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useAttachInspirationToBrief] Attaching to brief:", briefId);

      const attachFn = httpsCallable(functions, "attachInspirationToBrief");
      const result = await attachFn({ briefId, ...input });

      // Invalidate brief cache
      await mutate(
        (key) => typeof key === "string" && key.includes(`rp_design_briefs:${briefId}`),
        undefined,
        { revalidate: true }
      );

      return result.data as { ok: boolean };
    },
    [mutate]
  );

  return { attachInspirationToBrief };
}
