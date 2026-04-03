"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { RpProduct, RpVariantGeneratedRenderOutput } from "@/lib/types/firestore";

/** Fields needed to mirror `primaryVariantImageUrlForShopify` for the sample variant row. */
export type SampleVariantMediaForShopify8394 = {
  media?: { heroFront?: string | null; heroBack?: string | null } | null;
  mockupUrl?: string | null;
  flatRenders?: RpProduct["flatRenders"] | null;
  generatedRenderOutputs?: RpVariantGeneratedRenderOutput[] | null;
};

export type SampleGeneratedOutputs = {
  productId: string;
  variantId: string;
  outputs: RpVariantGeneratedRenderOutput[];
  variantMediaForShopify8394: SampleVariantMediaForShopify8394;
};

const MAX_PARENTS = 35;

/**
 * Finds one product variant document under `rp_products` for this master blank color that has
 * `generatedRenderOutputs` (QA preview in the blank variant editor; not authoritative if many products exist).
 */
export async function fetchSampleGeneratedOutputsForBlankVariant(
  blankId: string,
  blankVariantId: string
): Promise<SampleGeneratedOutputs | null> {
  if (!db) return null;
  const pq = query(collection(db, "rp_products"), where("blankId", "==", blankId), limit(MAX_PARENTS));
  const parents = await getDocs(pq);
  for (const p of parents.docs) {
    const data = p.data() as { productKind?: string };
    if (data.productKind !== "parent") continue;
    const vCol = collection(db, "rp_products", p.id, "variants");
    const vSnap = await getDocs(vCol);
    for (const vd of vSnap.docs) {
      const v = vd.data() as {
        blankVariantId?: string;
        generatedRenderOutputs?: unknown;
        media?: { heroFront?: string | null; heroBack?: string | null } | null;
        mockupUrl?: string | null;
        flatRenders?: RpProduct["flatRenders"] | null;
      };
      if (String(v.blankVariantId || "") !== blankVariantId) continue;
      const outs = v.generatedRenderOutputs;
      if (Array.isArray(outs) && outs.length > 0) {
        const typed = outs as RpVariantGeneratedRenderOutput[];
        return {
          productId: p.id,
          variantId: vd.id,
          outputs: typed,
          variantMediaForShopify8394: {
            media: v.media,
            mockupUrl: v.mockupUrl ?? null,
            flatRenders: v.flatRenders ?? null,
            generatedRenderOutputs: typed,
          },
        };
      }
    }
  }
  return null;
}

export function useSampleGeneratedOutputsForBlankVariant(
  blankId: string | undefined,
  blankVariantId: string | undefined
): {
  loading: boolean;
  error: string | null;
  sample: SampleGeneratedOutputs | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<SampleGeneratedOutputs | null>(null);

  useEffect(() => {
    if (!blankId || !blankVariantId || !db) {
      setLoading(false);
      setError(null);
      setSample(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSample(null);
    void (async () => {
      try {
        const s = await fetchSampleGeneratedOutputsForBlankVariant(blankId, blankVariantId);
        if (!cancelled) {
          setSample(s);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError((e as Error)?.message || "Failed to load sample outputs");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blankId, blankVariantId]);

  return { loading, error, sample };
}
