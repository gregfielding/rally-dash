/**
 * Step 10 MVP: canonical input fingerprint for flat renders (8394 back).
 * Must stay in sync with `functions/lib/productFlatRenderMvp.js` (stable JSON + sha256).
 *
 * Stale when any of: blank placement (back), blank/variant render defaults (back),
 * variant back image URL, design asset URL (light/dark), design revision, blank version.
 */

import type { DesignDoc, RPBlank, RPBlankVariant, RPPlacement, RpProduct } from "@/lib/types/firestore";
import { getVariantById, isMasterBlank } from "@/lib/blanks";
import { normalizeSimpleControls8394, derivePlacementEngineFields8394 } from "@/lib/blanks/simpleRenderControls8394";
import { pickDesignPngUrlForVariant } from "@/lib/designs/designHelpers";
export { pickDesignPngUrlForVariant };
import { getBlankVersionValue, getDesignVersionValue } from "@/lib/products/staleness";
import { DEFAULT_GARMENT_SAFE_AREA } from "@/lib/render/designArtboardSpec";
import {
  getPlacementFingerprintSliceForProduct,
  getPlacementRowForSide,
  resolveEffectiveRenderSettings,
} from "@/lib/products/resolveProductRenderProfile";

const MVP_STYLE_CODE = "8394";

export type FlatRenderPlacementFingerprintSlice = {
  placementId: string;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  safeArea: { x: number; y: number; w: number; h: number };
  artboardBase: number;
  renderZoneDefaults: { blendMode?: string | null; blendOpacity?: number | null } | null;
  /** 8394 simple controls (ink/realism/size); must match server fingerprint. */
  simpleRenderControls8394: {
    realism: number;
    inkStrength: number;
    sizePreset: string;
  } | null;
};

export type FlatRenderBackBlendSlice = {
  blendMode: string;
  blendOpacity: number;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringify(x)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Raw back zone row from blank.placements (prefer back_center). */
export function getBackPlacementRowForFlatRender(blank: RPBlank): RPPlacement | null {
  const list = blank.placements ?? [];
  const backPlacements = list.filter((p) => String(p.placementId).startsWith("back_"));
  if (backPlacements.length === 0) return null;
  return backPlacements.find((p) => p.placementId === "back_center") ?? backPlacements[0];
}

export function getBackPlacementFingerprintSlice(
  blank: RPBlank
): FlatRenderPlacementFingerprintSlice | null {
  const row = getBackPlacementRowForFlatRender(blank);
  if (!row) return null;
  const simple =
    row.simpleRenderControls8394 != null
      ? normalizeSimpleControls8394(row.simpleRenderControls8394)
      : null;
  return {
    placementId: row.placementId,
    defaultX: row.defaultX ?? 0.5,
    defaultY: row.defaultY ?? 0.5,
    defaultScale: row.defaultScale ?? 0.6,
    safeArea: row.safeArea ?? { ...DEFAULT_GARMENT_SAFE_AREA },
    artboardBase: row.artboardBase ?? 0.5,
    renderZoneDefaults: row.renderZoneDefaults ?? null,
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
  };
}

/**
 * Merge variant overrides > zone renderZoneDefaults > blank renderDefaults (back).
 */
export function getBackBlendForFlatRender(
  blank: RPBlank,
  variant: RPBlankVariant,
  placementRow: RPPlacement | null
): FlatRenderBackBlendSlice {
  const rd = blank.renderDefaults;
  const vo = variant.renderOverrides;
  const derivedFromSimple =
    placementRow?.simpleRenderControls8394 != null
      ? derivePlacementEngineFields8394(placementRow.simpleRenderControls8394).renderZoneDefaults
      : null;
  const zd = derivedFromSimple ?? placementRow?.renderZoneDefaults;
  const modeRaw =
    (vo?.blendMode as string | null | undefined) ??
    zd?.blendMode ??
    rd?.back?.blendMode ??
    rd?.blendMode ??
    "multiply";
  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opRaw =
    vo?.blendOpacity ??
    zd?.blendOpacity ??
    rd?.back?.blendOpacity ??
    rd?.blendOpacity ??
    1;
  const opacity = typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;
  return { blendMode: mode, blendOpacity: opacity };
}

/** Ink / contrast multipliers for UI + server (8394 back). */
export function get8394DesignTreatmentFromPlacement(placementRow: RPPlacement | null): {
  designOpacityMultiplier: number;
  contrastPercent: number;
  realism: number;
} {
  if (!placementRow?.simpleRenderControls8394) {
    return { designOpacityMultiplier: 1, contrastPercent: 100, realism: 0 };
  }
  const d = derivePlacementEngineFields8394(placementRow.simpleRenderControls8394);
  const n = normalizeSimpleControls8394(placementRow.simpleRenderControls8394);
  return {
    designOpacityMultiplier: d.designOpacityMultiplier,
    contrastPercent: d.contrastPercent,
    realism: n.realism,
  };
}

export function getVariantBackImageUrl(blank: RPBlank, variant: RPBlankVariant): string | null {
  return variant.images?.back?.downloadUrl ?? blank.images?.back?.downloadUrl ?? null;
}

/**
 * True when this product is in scope for Step 10 MVP server renderer (8394 + master blank + variant back art).
 */
export function isProductInFlatRenderMvpScope(
  product: RpProduct,
  blank: RPBlank | null | undefined
): boolean {
  if (!blank || String(blank.styleCode || "").trim() !== MVP_STYLE_CODE) return false;
  if (!isMasterBlank(blank)) return false;
  if (!product.blankId || !product.blankVariantId) return false;
  const v = getVariantById(blank, product.blankVariantId);
  if (!v) return false;
  return !!getVariantBackImageUrl(blank, v);
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new Error("Web Crypto API not available for flat render fingerprint");
  }
  const enc = new TextEncoder();
  const buf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeProductFlatRenderFingerprintAsync(params: {
  blank: RPBlank;
  variant: RPBlankVariant;
  design: DesignDoc;
  product: RpProduct;
}): Promise<string> {
  const { blank, variant, design, product } = params;
  const placementRow = getPlacementRowForSide(blank, "back", product.renderSetup?.back?.placementKey);
  const placement = getPlacementFingerprintSliceForProduct(blank, product, "back");
  const blendEff = resolveEffectiveRenderSettings(product, blank, variant, placementRow, "back");
  const blend = { blendMode: blendEff.blendMode, blendOpacity: blendEff.blendOpacity };
  const { url: designAssetUrl, ref: designAssetRef } = pickDesignPngUrlForVariant(design, variant);
  const variantBackUrl = getVariantBackImageUrl(blank, variant);
  const designId = product.designIdBack?.trim() || product.designId?.trim() || "";

  const payload = {
    scope: "step10_mvp_8394_back_v4",
    blankId: product.blankId,
    blankVariantId: product.blankVariantId,
    blankVersion: getBlankVersionValue(blank),
    placementBack: placement,
    backBlend: blend,
    variantBackUrl,
    designId,
    designVersion: getDesignVersionValue(design),
    designAssetRef,
    designAssetUrl,
  };

  const full = await sha256Hex(stableStringify(payload));
  return full.slice(0, 40);
}

export function isFlatRenderSlotStale(
  slot: { inputFingerprint: string } | null | undefined,
  currentFingerprint: string | null
): boolean {
  if (!slot?.inputFingerprint || !currentFingerprint) return true;
  return slot.inputFingerprint !== currentFingerprint;
}
