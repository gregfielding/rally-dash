"use client";

import { useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/config";
import { useSWRConfig } from "swr";
import {
  RpPrintMethod,
  RpDesignPlacement,
  RpInkColor,
} from "@/lib/types/firestore";

export interface CreateProductDesignInput {
  productId: string;
  designKey?: string; // Optional, will be generated from name if not provided
  name: string;
  description?: string;
  inkColors: RpInkColor[];
  printMethod: RpPrintMethod;
  maxInkColors?: number;
  placement: RpDesignPlacement;
  placementNotes?: string;
  sizeSpec?: {
    widthIn?: number;
    heightIn?: number;
    notes?: string;
  };
  textElements?: string[];
  styleTags?: string[];
  briefId?: string;
  existingDesignId?: string; // If editing, will check immutability
}

export interface CreateDesignFromConceptInput {
  productId: string;
  briefId: string;
  conceptId: string;
  name?: string; // Optional override
  description?: string; // Optional override
}

export interface CreateDesignBriefInput {
  productId: string;
  title: string;
  objective: string;
  audience?: string;
  brandNotes?: string;
  constraints: {
    printMethod: RpPrintMethod;
    maxInkColors: number;
    mustIncludeText?: string[];
    avoid?: string[];
    placementOptions?: RpDesignPlacement[];
    requiredInkColors?: RpInkColor[];
    allowedInkColors?: RpInkColor[];
  };
  inspiration?: {
    notes?: string;
    links?: string[];
  };
}

/**
 * Hook for creating product designs
 */
export function useCreateProductDesign() {
  const { mutate } = useSWRConfig();

  const createProductDesign = useCallback(
    async (input: CreateProductDesignInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useCreateProductDesign] Creating design:", input);

      const createDesignFn = httpsCallable(functions, "createProductDesign");
      const result = await createDesignFn(input);

      // Invalidate designs cache
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product_designs"),
        undefined,
        { revalidate: true }
      );

      return result.data as { ok: boolean; designId: string; version: number; slug: string };
    },
    [mutate]
  );

  return { createProductDesign };
}

/**
 * Hook for creating designs from concepts
 */
export function useCreateDesignFromConcept() {
  const { mutate } = useSWRConfig();

  const createDesignFromConcept = useCallback(
    async (input: CreateDesignFromConceptInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useCreateDesignFromConcept] Promoting concept:", input);

      const promoteFn = httpsCallable(functions, "createDesignFromConcept");
      const result = await promoteFn(input);

      // Invalidate caches
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_product_designs"),
        undefined,
        { revalidate: true }
      );
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_design_concepts"),
        undefined,
        { revalidate: true }
      );

      return result.data as { ok: boolean; designId: string; version: number; slug: string };
    },
    [mutate]
  );

  return { createDesignFromConcept };
}

/**
 * Hook for creating design briefs with AI
 */
export function useCreateDesignBrief() {
  const { mutate } = useSWRConfig();

  const createDesignBrief = useCallback(
    async (input: CreateDesignBriefInput) => {
      if (!functions) {
        throw new Error("Cloud Functions not initialized");
      }

      console.log("[useCreateDesignBrief] Creating brief:", input);

      const createBriefFn = httpsCallable(functions, "createDesignBrief");
      const result = await createBriefFn(input);

      // Invalidate caches
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_design_briefs"),
        undefined,
        { revalidate: true }
      );
      await mutate(
        (key) => typeof key === "string" && key.startsWith("rp_design_concepts"),
        undefined,
        { revalidate: true }
      );

      return result.data as {
        ok: boolean;
        briefId: string;
        conceptIds: string[];
        conceptsGenerated: number;
      };
    },
    [mutate]
  );

  return { createDesignBrief };
}
