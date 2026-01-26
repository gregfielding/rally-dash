"use client";

import { useCallback } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/lib/providers/AuthProvider";

interface ReviewInput {
  status: "pending" | "approved" | "rejected" | "needs_revision";
  rating?: number; // 1-5
  notes?: string;
  revisionNotes?: string;
}

export function useAssetReview() {
  const { user } = useAuth();

  const reviewAsset = useCallback(
    async (assetId: string, review: ReviewInput) => {
      if (!db) throw new Error("Database not initialized");
      if (!user) throw new Error("User must be authenticated");

      const assetRef = doc(db, "rp_product_assets", assetId);
      await updateDoc(assetRef, {
        review: {
          ...review,
          reviewedBy: user.uid,
          reviewedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      });
    },
    [user]
  );

  const approveAsset = useCallback(
    async (assetId: string, rating?: number, notes?: string) => {
      return reviewAsset(assetId, {
        status: "approved",
        rating,
        notes,
      });
    },
    [reviewAsset]
  );

  const rejectAsset = useCallback(
    async (assetId: string, notes?: string) => {
      return reviewAsset(assetId, {
        status: "rejected",
        notes,
      });
    },
    [reviewAsset]
  );

  const requestRevision = useCallback(
    async (assetId: string, revisionNotes: string) => {
      return reviewAsset(assetId, {
        status: "needs_revision",
        revisionNotes,
      });
    },
    [reviewAsset]
  );

  return {
    reviewAsset,
    approveAsset,
    rejectAsset,
    requestRevision,
  };
}
