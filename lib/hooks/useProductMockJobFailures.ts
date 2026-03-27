"use client";

import { db } from "@/lib/firebase/config";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";

/**
 * Live map of variantId → latest error message for failed mock jobs tied to this product.
 * Stale failures may remain in Firestore; pair with base-complete checks in the UI.
 */
export function useProductFailedMockJobsByVariant(productId: string | null | undefined) {
  const [byVariantId, setByVariantId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!db || !productId) {
      setByVariantId({});
      return;
    }

    const q = query(
      collection(db, "rp_mock_jobs"),
      where("productId", "==", productId),
      where("status", "==", "failed")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Record<string, string> = {};
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as {
            productVariantId?: string | null;
            error?: { message?: string | null };
          };
          const vid = data.productVariantId;
          if (typeof vid === "string" && vid.trim()) {
            const msg = data.error?.message?.trim() || "Mock job failed";
            next[vid] = msg;
          }
        });
        setByVariantId(next);
      },
      (err) => {
        console.error("[useProductFailedMockJobsByVariant]", err);
      }
    );

    return () => unsub();
  }, [productId]);

  return byVariantId;
}
