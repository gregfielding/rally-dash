"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG } from "@/lib/officialScenePreset";

type Props = {
  product: { id?: string; officialScenePresetId?: string | null } | null;
};

/**
 * Dev/ops readout: which preset id official 8394 asset enqueue would resolve, and whether the doc exists.
 * Server also applies OFFICIAL_PRODUCT_SCENE_PRESET_ID (not visible in browser unless NEXT_PUBLIC_* is set).
 */
export default function Official8394EnqueuePresetReadout({ product }: Props) {
  const [slugDocId, setSlugDocId] = useState<string | null>(null);
  const [slugLoading, setSlugLoading] = useState(false);

  const fromProduct = useMemo(() => {
    const v = product?.officialScenePresetId;
    return v && String(v).trim() ? String(v).trim() : null;
  }, [product?.officialScenePresetId]);

  const fromPublicEnv = useMemo(() => {
    try {
      const e = process.env.NEXT_PUBLIC_OFFICIAL_PRODUCT_SCENE_PRESET_ID;
      return e && String(e).trim() ? String(e).trim() : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setSlugLoading(true);
    (async () => {
      try {
        const q = query(
          collection(db, "rp_scene_presets"),
          where("slug", "==", DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG),
          limit(1)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setSlugDocId(snap.empty ? null : snap.docs[0].id);
      } catch {
        if (!cancelled) setSlugDocId(null);
      } finally {
        if (!cancelled) setSlugLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product?.id]);

  const resolvedPreview = fromProduct || fromPublicEnv || slugDocId;
  const resolutionSource = fromProduct
    ? "product.officialScenePresetId"
    : fromPublicEnv
      ? "NEXT_PUBLIC_OFFICIAL_PRODUCT_SCENE_PRESET_ID"
      : slugDocId
        ? `slug “${DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG}” (Functions also uses env OFFICIAL_PRODUCT_SCENE_PRESET_ID first)`
        : null;

  const [docExists, setDocExists] = useState<boolean | null>(null);
  useEffect(() => {
    if (!db || !resolvedPreview) {
      setDocExists(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await getDoc(doc(db, "rp_scene_presets", resolvedPreview));
        if (!cancelled) setDocExists(s.exists());
      } catch {
        if (!cancelled) setDocExists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedPreview, product?.id]);

  if (!product?.id) return null;

  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 p-3 text-xs text-gray-800 space-y-1.5">
      <div className="font-semibold text-amber-900">8394 official asset enqueue — scene preset</div>
      <div>
        <span className="text-gray-500">Resolved id (preview): </span>
        <code className="text-[11px] bg-white/80 px-1 rounded">{resolvedPreview ?? "—"}</code>
      </div>
      {resolutionSource ? (
        <div className="text-gray-600">
          <span className="text-gray-500">Source: </span>
          {resolutionSource}
        </div>
      ) : (
        <div className="text-red-700">
          No product id, no public env id, and no preset with slug{" "}
          <code className="text-[11px]">{DEFAULT_OFFICIAL_8394_SCENE_PRESET_SLUG}</code> found
          {slugLoading ? " (loading…)" : ""}. Run <code className="text-[11px]">npm run seed:presets</code> in{" "}
          <code className="text-[11px]">functions</code> or set env / product field.
        </div>
      )}
      <div>
        <span className="text-gray-500">Preset doc exists: </span>
        {resolvedPreview == null ? (
          "—"
        ) : docExists === null ? (
          "…"
        ) : docExists ? (
          <span className="text-green-700 font-medium">yes</span>
        ) : (
          <span className="text-red-700 font-medium">no</span>
        )}
        {resolvedPreview ? (
          <span className="text-gray-500 ml-1">
            (<code className="text-[10px]">rp_scene_presets/{resolvedPreview}</code>)
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-gray-500 pt-1 border-t border-amber-200/60">
        Deployed Functions may still resolve a different id via <code>OFFICIAL_PRODUCT_SCENE_PRESET_ID</code> before the
        slug fallback; that value is not exposed here unless you mirror it with{" "}
        <code>NEXT_PUBLIC_OFFICIAL_PRODUCT_SCENE_PRESET_ID</code>.
      </p>
    </div>
  );
}
