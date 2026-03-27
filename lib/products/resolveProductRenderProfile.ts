/**
 * Resolve effective placement / render settings for a product.
 *
 * **Hierarchy (canonical):**
 * 1. Blank `placements[]` row (+ blank `renderDefaults`)
 * 2. Blank **color variant** `renderProfileOverrides.{front|back}` + variant `renderOverrides` (global blend hint)
 * 3. Product `placementOverrides` / `renderOverrides` (wins over variant)
 * 4. Legacy `renderSetup.*` placement + blend (backward compatibility)
 *
 * Design artwork does not own placement; design `placementDefaults` are advisory only (engines may consult separately).
 */

import type {
  RPBlank,
  RPBlankVariant,
  RPPlacement,
  RPPlacementId,
  RpProduct,
  RpProductPlacementOverrideSlice,
  RpProductRenderOverrideSlice,
} from "@/lib/types/firestore";
import { DEFAULT_GARMENT_SAFE_AREA } from "@/lib/render/designArtboardSpec";
import { normalizeSimpleControls8394, derivePlacementEngineFields8394 } from "@/lib/blanks/simpleRenderControls8394";

export type PlacementResolutionSource = "blank" | "variant_override" | "product_override" | "legacy_render_setup";

export type EffectivePlacement = {
  placementId: RPPlacementId;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  safeArea: { x: number; y: number; w: number; h: number };
  artboardBase: number;
  /** Where non-blank values came from (for UI). */
  source: PlacementResolutionSource;
};

export type EffectiveRenderSettings = {
  blendMode: string;
  blendOpacity: number;
  source: PlacementResolutionSource;
};

function placementRowsForSide(blank: RPBlank, side: "front" | "back"): RPPlacement[] {
  const list = blank.placements ?? [];
  const prefix = side === "front" ? "front_" : "back_";
  return list.filter((p) => String(p.placementId).startsWith(prefix));
}

/** Prefer *_center, else first zone for that side. */
export function getPlacementRowForSide(
  blank: RPBlank,
  side: "front" | "back",
  placementId?: string | null
): RPPlacement | null {
  const rows = placementRowsForSide(blank, side);
  if (rows.length === 0) return null;
  if (placementId && rows.some((r) => r.placementId === placementId)) {
    return rows.find((r) => r.placementId === placementId) ?? null;
  }
  const centerId = (side === "front" ? "front_center" : "back_center") as RPPlacementId;
  return rows.find((r) => r.placementId === centerId) ?? rows[0];
}

function readLegacyPlacementOverride(
  product: RpProduct | null | undefined,
  side: "front" | "back"
): { x?: number; y?: number; scale?: number } | null {
  if (!product?.renderSetup) return null;
  const po = side === "front" ? product.renderSetup.front?.placementOverride : product.renderSetup.back?.placementOverride;
  if (!po || typeof po !== "object") return null;
  const out: { x?: number; y?: number; scale?: number } = {};
  if (typeof po.x === "number") out.x = po.x;
  if (typeof po.y === "number") out.y = po.y;
  if (typeof po.scale === "number") out.scale = po.scale;
  return Object.keys(out).length ? out : null;
}

function readStructuredPlacementOverride(
  product: RpProduct | null | undefined,
  side: "front" | "back"
): RpProductPlacementOverrideSlice | null {
  const slice = product?.placementOverrides?.[side];
  if (!slice || typeof slice !== "object") return null;
  const has =
    slice.defaultX != null ||
    slice.defaultY != null ||
    slice.defaultScale != null ||
    (slice.safeArea != null &&
      (slice.safeArea.x != null ||
        slice.safeArea.y != null ||
        slice.safeArea.w != null ||
        slice.safeArea.h != null));
  return has ? slice : null;
}

/** True if this product has any explicit placement override for the side (new or legacy). */
export function hasProductPlacementOverride(
  product: RpProduct | null | undefined,
  side: "front" | "back"
): boolean {
  return readStructuredPlacementOverride(product, side) != null || readLegacyPlacementOverride(product, side) != null;
}

function mergeSafeArea(
  base: { x: number; y: number; w: number; h: number },
  over?: { x?: number; y?: number; w?: number; h?: number } | null
): { x: number; y: number; w: number; h: number } {
  if (!over) return base;
  return {
    x: over.x ?? base.x,
    y: over.y ?? base.y,
    w: over.w ?? base.w,
    h: over.h ?? base.h,
  };
}

function variantSideSlice(variant: RPBlankVariant | null | undefined, side: "front" | "back") {
  const o = variant?.renderProfileOverrides;
  if (!o) return null;
  return side === "front" ? o.front : o.back;
}

/** Placement zone key: product wins, else variant per-side override, else default row picker. */
export function resolvePlacementKeyForSide(
  product: RpProduct | null | undefined,
  variant: RPBlankVariant | null | undefined,
  side: "front" | "back"
): string | null {
  const vk = variantSideSlice(variant, side)?.placementKey ?? null;
  return (
    (side === "front"
      ? product?.renderSetup?.front?.placementKey
      : product?.renderSetup?.back?.placementKey) ?? vk ?? null
  );
}

function mergeSimple8394FromVariant(
  placementRow: RPPlacement | null,
  variant: RPBlankVariant | null | undefined,
  side: "front" | "back"
) {
  if (side !== "back" || !placementRow?.simpleRenderControls8394) return placementRow?.simpleRenderControls8394 ?? null;
  const partial = variantSideSlice(variant, "back")?.simpleRenderControls8394;
  if (!partial) return placementRow.simpleRenderControls8394;
  return { ...placementRow.simpleRenderControls8394, ...partial };
}

/**
 * Effective placement for mockups, previews, and fingerprints.
 * Order: blank row → variant `renderProfileOverrides` → product `placementOverrides` → legacy `renderSetup`.
 */
export function resolveEffectivePlacement(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  side: "front" | "back",
  variant?: RPBlankVariant | null
): EffectivePlacement | null {
  const placementKey = resolvePlacementKeyForSide(product, variant ?? null, side);
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;

  const baseX = row.defaultX ?? 0.5;
  const baseY = row.defaultY ?? 0.5;
  const baseScale = row.defaultScale ?? 0.6;
  const baseSafe = row.safeArea ?? { ...DEFAULT_GARMENT_SAFE_AREA };
  const artboardBase =
    row.artboardBase != null && Number.isFinite(Number(row.artboardBase)) ? Number(row.artboardBase) : 0.5;

  const vs = variantSideSlice(variant, side);
  let defaultX = baseX;
  let defaultY = baseY;
  let defaultScale = baseScale;
  let safeArea = { ...baseSafe };
  let variantTouched = false;

  if (vs) {
    if (vs.defaultX != null) {
      defaultX = vs.defaultX;
      variantTouched = true;
    }
    if (vs.defaultY != null) {
      defaultY = vs.defaultY;
      variantTouched = true;
    }
    if (vs.defaultScale != null) {
      defaultScale = vs.defaultScale;
      variantTouched = true;
    }
    if (vs.safeArea && Object.keys(vs.safeArea).length > 0) {
      safeArea = mergeSafeArea(safeArea, vs.safeArea);
      variantTouched = true;
    }
  }

  const structured = readStructuredPlacementOverride(product, side);
  const legacy = readLegacyPlacementOverride(product, side);

  let source: PlacementResolutionSource = "blank";

  if (structured) {
    if (structured.defaultX != null) defaultX = structured.defaultX;
    if (structured.defaultY != null) defaultY = structured.defaultY;
    if (structured.defaultScale != null) defaultScale = structured.defaultScale;
    safeArea = mergeSafeArea(safeArea, structured.safeArea);
    source = "product_override";
  } else if (legacy) {
    if (legacy.x != null) defaultX = legacy.x;
    if (legacy.y != null) defaultY = legacy.y;
    if (legacy.scale != null) defaultScale = legacy.scale;
    source = "legacy_render_setup";
  } else if (variantTouched) {
    source = "variant_override";
  }

  return {
    placementId: row.placementId,
    defaultX,
    defaultY,
    defaultScale,
    safeArea,
    artboardBase,
    source,
  };
}

/**
 * Effective blend for a side: blank zone (+ merged 8394 simple with variant) → variant side `renderZoneDefaults`
 * → variant global `renderOverrides` → product `renderOverrides` → legacy `renderSetup.*`.
 */
export function resolveEffectiveRenderSettings(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  placementRow: RPPlacement | null,
  side: "front" | "back"
): EffectiveRenderSettings {
  const rd = blank.renderDefaults;
  const mergedSimple = mergeSimple8394FromVariant(placementRow, variant, side);
  const derivedFromSimple =
    mergedSimple != null ? derivePlacementEngineFields8394(mergedSimple).renderZoneDefaults : null;
  let zd = derivedFromSimple ?? placementRow?.renderZoneDefaults ?? null;

  const sideProf = variantSideSlice(variant, side);
  if (sideProf?.renderZoneDefaults && (sideProf.renderZoneDefaults.blendMode != null || sideProf.renderZoneDefaults.blendOpacity != null)) {
    zd = {
      blendMode: sideProf.renderZoneDefaults.blendMode ?? zd?.blendMode ?? null,
      blendOpacity: sideProf.renderZoneDefaults.blendOpacity ?? zd?.blendOpacity ?? null,
    };
  }

  const sideRd = side === "front" ? rd?.front : rd?.back;
  const vo = variant?.renderOverrides;

  let modeRaw =
    vo?.blendMode ??
    zd?.blendMode ??
    sideRd?.blendMode ??
    rd?.blendMode ??
    "multiply";
  let opRaw =
    vo?.blendOpacity ?? zd?.blendOpacity ?? sideRd?.blendOpacity ?? rd?.blendOpacity ?? 1;

  const simplePatch = sideProf?.simpleRenderControls8394;
  const variantBlendTouched =
    !!(simplePatch && Object.keys(simplePatch).length > 0) ||
    !!(sideProf?.renderZoneDefaults &&
      (sideProf.renderZoneDefaults.blendMode != null || sideProf.renderZoneDefaults.blendOpacity != null)) ||
    vo?.blendMode != null ||
    vo?.blendOpacity != null;

  let source: PlacementResolutionSource = "blank";

  const ro: RpProductRenderOverrideSlice | null | undefined = product?.renderOverrides?.[side];
  if (ro && (ro.blendMode != null || ro.blendOpacity != null)) {
    if (ro.blendMode != null && String(ro.blendMode).trim()) {
      modeRaw = ro.blendMode;
    }
    if (ro.blendOpacity != null && Number.isFinite(ro.blendOpacity)) {
      opRaw = ro.blendOpacity;
    }
    source = "product_override";
  } else {
    const rsSide = side === "front" ? product?.renderSetup?.front : product?.renderSetup?.back;
    if (rsSide && (rsSide.blendMode != null || rsSide.blendOpacity != null)) {
      if (rsSide.blendMode != null && String(rsSide.blendMode).trim()) {
        modeRaw = rsSide.blendMode;
      }
      if (rsSide.blendOpacity != null && Number.isFinite(rsSide.blendOpacity)) {
        opRaw = rsSide.blendOpacity;
      }
      source = "legacy_render_setup";
    } else if (variantBlendTouched) {
      source = "variant_override";
    }
  }

  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opacity =
    typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;

  return { blendMode: mode, blendOpacity: opacity, source };
}

/** Fingerprint slice for flat render / stale checks — uses **resolved** placement (blank + variant + product). */
export function getPlacementFingerprintSliceForProduct(
  blank: RPBlank,
  product: RpProduct | null | undefined,
  side: "front" | "back",
  variant?: RPBlankVariant | null
): {
  placementId: string;
  defaultX: number;
  defaultY: number;
  defaultScale: number;
  safeArea: { x: number; y: number; w: number; h: number };
  artboardBase: number;
  renderZoneDefaults: { blendMode?: string | null; blendOpacity?: number | null } | null;
  simpleRenderControls8394: { realism: number; inkStrength: number; sizePreset: string } | null;
} | null {
  const pk = resolvePlacementKeyForSide(product, variant ?? null, side);
  const row = getPlacementRowForSide(blank, side, pk);
  if (!row) return null;

  const eff = resolveEffectivePlacement(product, blank, side, variant);
  if (!eff) return null;

  const mergedSimpleRaw = mergeSimple8394FromVariant(row, variant ?? null, side);
  const simple =
    mergedSimpleRaw != null ? normalizeSimpleControls8394(mergedSimpleRaw) : null;

  const blendEff = resolveEffectiveRenderSettings(product, blank, variant ?? null, row, side);

  return {
    placementId: row.placementId,
    defaultX: eff.defaultX,
    defaultY: eff.defaultY,
    defaultScale: eff.defaultScale,
    safeArea: eff.safeArea,
    artboardBase: eff.artboardBase,
    renderZoneDefaults: { blendMode: blendEff.blendMode, blendOpacity: blendEff.blendOpacity },
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
  };
}
