"use client";

import { useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/config";

interface BatchGenerationRequest {
  productId: string;
  presetId: string;
  identityId?: string;
  designId?: string;
  generationType?: "product_only" | "on_model";
  artifacts?: {
    faceArtifactId?: string;
    bodyArtifactId?: string;
    productArtifactId?: string;
    faceScale?: number;
    bodyScale?: number;
    productScale?: number;
  };
  imageCount?: number;
  size?: "square" | "portrait" | "landscape";
  seed?: string;
  promptOverrides?: {
    prompt?: string;
    negativePrompt?: string;
  };
}

interface BatchGenerationInput {
  requests: BatchGenerationRequest[];
  batchName?: string;
}

interface BatchGenerationResult {
  ok: boolean;
  batchJobId: string;
  totalRequests: number;
  successfulJobs: number;
  failedJobs: number;
  jobIds: string[];
  errors?: Array<{
    index: number;
    request: BatchGenerationRequest;
    error: string;
  }>;
}

export function useBatchGeneration() {
  const batchGenerate = useCallback(async (input: BatchGenerationInput): Promise<BatchGenerationResult> => {
    if (!functions) {
      throw new Error("Firebase Functions not initialized");
    }

    const batchGenerateProductAssets = httpsCallable<BatchGenerationInput, BatchGenerationResult>(
      functions,
      "batchGenerateProductAssets"
    );

    const result = await batchGenerateProductAssets(input);
    return result.data;
  }, []);

  return { batchGenerate };
}
