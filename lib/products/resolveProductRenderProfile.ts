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
  RPBlankVariantRenderProfileSideOverride,
  RPPlacement,
  RPPlacementId,
  RpBlendSettings,
  RpPlacementSettings,
  RpProduct,
  RpProductPlacementOverrideSlice,
  RpProductRenderOverrideSlice,
  RpRenderTarget,
  RpRenderTargetKey,
  RpRenderTargetSettings,
} from "@/lib/types/firestore";
import { DEFAULT_GARMENT_SAFE_AREA } from "@/lib/render/designArtboardSpec";
import {
  normalizeSimpleControls8394,
  derivePlacementEngineFields8394,
  mapRealismToBlend,
} from "@/lib/blanks/simpleRenderControls8394";
import type { PlacementRowLike } from "@/lib/render/renderTargetTuning";
import {
  RENDER_TARGETS,
  blendSettingsToEngineBlend,
  buildRenderTargetSettingsMap,
  cloneRenderTargetSettings,
  getDefaultRenderTargetSettings,
  mergeRenderTargetSettings,
  variantRenderTargetSliceIsMeaningful,
  variantSliceToRenderTargetSettingsPatch,
} from "@/lib/render/renderTargetTuning";

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
    slice.scaleMultiplier != null ||
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

export function renderTargetToSide(target: RpRenderTargetKey): "front" | "back" {
  return target === "flat_front" || target === "model_front" ? "front" : "back";
}

export function variantRenderTargetSlice(
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey
): RPBlankVariantRenderProfileSideOverride | null {
  const o = variant?.renderTargetOverrides;
  if (!o) return null;
  return o[target] ?? null;
}

function variantSliceForRenderTarget(
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey
): RPBlankVariantRenderProfileSideOverride | null {
  const side = renderTargetToSide(target);
  const rt = variantRenderTargetSlice(variant, target);
  const leg = variantSideSlice(variant, side);
  if (target !== "flat_back" && target !== "flat_front") {
    return rt ?? null;
  }
  if (!leg && !rt) return null;
  if (!leg) return rt;
  if (!rt) return leg;
  return {
    placementKey: rt.placementKey != null && String(rt.placementKey).trim() ? rt.placementKey : leg.placementKey,
    defaultX: rt.defaultX != null ? rt.defaultX : leg.defaultX,
    defaultY: rt.defaultY != null ? rt.defaultY : leg.defaultY,
    defaultScale: rt.defaultScale != null ? rt.defaultScale : leg.defaultScale,
    safeArea:
      rt.safeArea && Object.keys(rt.safeArea).length > 0
        ? mergeSafeArea(
            {
              x: leg.safeArea?.x ?? 0,
              y: leg.safeArea?.y ?? 0,
              w: leg.safeArea?.w ?? 1,
              h: leg.safeArea?.h ?? 1,
            },
            rt.safeArea
          )
        : leg.safeArea,
    simpleRenderControls8394: (() => {
      const a = leg.simpleRenderControls8394 ?? {};
      const b = rt.simpleRenderControls8394 ?? {};
      const out = { ...a, ...b };
      return Object.keys(out).length > 0 ? out : null;
    })(),
    renderZoneDefaults: (() => {
      const a = leg.renderZoneDefaults ?? {};
      const b = rt.renderZoneDefaults ?? {};
      if (!Object.keys(b).length) return Object.keys(a).length ? a : null;
      return {
        blendMode: b.blendMode ?? a.blendMode,
        blendOpacity: b.blendOpacity ?? a.blendOpacity,
      };
    })(),
  };
}

/** Placement zone key: product wins, else merged variant slice for this render target. */
export function resolvePlacementKeyForRenderTarget(
  product: RpProduct | null | undefined,
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey
): string | null {
  const side = renderTargetToSide(target);
  const pkProduct =
    side === "front" ? product?.renderSetup?.front?.placementKey : product?.renderSetup?.back?.placementKey;
  if (pkProduct != null && String(pkProduct).trim()) return pkProduct;
  const slice = variantSliceForRenderTarget(variant, target);
  return slice?.placementKey ?? null;
}

function mergeSimple8394ForTarget(
  placementRow: RPPlacement | null,
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey
) {
  if (!placementRow?.simpleRenderControls8394) return null;
  const slice = variantSliceForRenderTarget(variant, target);
  const partial = slice?.simpleRenderControls8394;
  if (!partial) return placementRow.simpleRenderControls8394;
  return { ...placementRow.simpleRenderControls8394, ...partial };
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
    /** Mirrors functions/lib: per-product design-class sizing multiplied over per-color blank tuning. */
    if (structured.scaleMultiplier != null && Number.isFinite(Number(structured.scaleMultiplier)) && Number(structured.scaleMultiplier) > 0) {
      defaultScale = defaultScale * Number(structured.scaleMultiplier);
    }
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
 * Placement for a specific render target (`flat_back` merges legacy `renderProfileOverrides.back` + `renderTargetOverrides.flat_back`;
 * `model_back` uses only `renderTargetOverrides.model_back` when set, else blank defaults).
 */
export function resolveEffectivePlacementForRenderTarget(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey
): EffectivePlacement | null {
  const side = renderTargetToSide(target);
  const placementKey = resolvePlacementKeyForRenderTarget(product, variant, target);
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;

  const baseX = row.defaultX ?? 0.5;
  const baseY = row.defaultY ?? 0.5;
  const baseScale = row.defaultScale ?? 0.6;
  const baseSafe = row.safeArea ?? { ...DEFAULT_GARMENT_SAFE_AREA };
  const artboardBase =
    row.artboardBase != null && Number.isFinite(Number(row.artboardBase)) ? Number(row.artboardBase) : 0.5;

  const vs = variantSliceForRenderTarget(variant, target);
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
    /** Mirrors functions/lib: per-product design-class sizing multiplied over per-color blank tuning. */
    if (structured.scaleMultiplier != null && Number.isFinite(Number(structured.scaleMultiplier)) && Number(structured.scaleMultiplier) > 0) {
      defaultScale = defaultScale * Number(structured.scaleMultiplier);
    }
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

export function resolveEffectiveRenderSettingsForRenderTarget(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  placementRow: RPPlacement | null,
  target: RpRenderTargetKey
): EffectiveRenderSettings {
  const side = renderTargetToSide(target);
  const mergedSimple = mergeSimple8394ForTarget(placementRow, variant, target);
  const derivedFromSimple =
    mergedSimple != null ? derivePlacementEngineFields8394(mergedSimple).renderZoneDefaults : null;
  let zd = derivedFromSimple ?? placementRow?.renderZoneDefaults ?? null;

  const sideProf = variantSliceForRenderTarget(variant, target);
  if (sideProf?.renderZoneDefaults && (sideProf.renderZoneDefaults.blendMode != null || sideProf.renderZoneDefaults.blendOpacity != null)) {
    zd = {
      blendMode: sideProf.renderZoneDefaults.blendMode ?? zd?.blendMode ?? null,
      blendOpacity: sideProf.renderZoneDefaults.blendOpacity ?? zd?.blendOpacity ?? null,
    };
  }

  const sideRd = side === "front" ? blank.renderDefaults?.front : blank.renderDefaults?.back;
  const vo = variant?.renderOverrides;

  let modeRaw =
    vo?.blendMode ??
    zd?.blendMode ??
    sideRd?.blendMode ??
    blank.renderDefaults?.blendMode ??
    "multiply";
  let opRaw =
    vo?.blendOpacity ?? zd?.blendOpacity ?? sideRd?.blendOpacity ?? blank.renderDefaults?.blendOpacity ?? 1;

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

function productPlacementToRenderTargetSettingsPatch(
  product: RpProduct | null | undefined,
  side: "front" | "back"
): Partial<RpRenderTargetSettings> {
  const st = readStructuredPlacementOverride(product, side);
  const leg = readLegacyPlacementOverride(product, side);
  const p: Partial<RpPlacementSettings> = {};
  if (st?.defaultX != null) p.x = st.defaultX;
  if (st?.defaultY != null) p.y = st.defaultY;
  if (st?.defaultScale != null) p.scale = st.defaultScale;
  if (leg?.x != null) p.x = leg.x;
  if (leg?.y != null) p.y = leg.y;
  if (leg?.scale != null) p.scale = leg.scale;
  if (Object.keys(p).length === 0) return {};
  return { placement: p as RpPlacementSettings };
}

export type RenderProfileTuningLayer = "color_matrix" | "blank_renderTargets" | "placement_defaults";

export type ResolveRenderTargetSettingsQa = {
  target: RpRenderTargetKey;
  blankTuningExisted: boolean;
  variantTargetOverrideExisted: boolean;
  productPlacementApplied: boolean;
  /** Highest-precedence blank-owned layer that contributed tuning (before legacy variant + product patches). */
  primaryTuningLayer: RenderProfileTuningLayer;
  colorMatrixCellExisted: boolean;
};

/**
 * Effective per-render-target tuning (merge order — later wins):
 * placement row defaults → blank `renderProfile.renderTargets[target]` → legacy `variant.renderTargetOverrides[target]`
 * → **`renderProfile.renderTargetsByColor[variantId][target]`** (matrix wins over legacy variant for the same fields)
 * → product placement override (x/y/scale only). Geometry (safe area) stays on `placements[]`.
 * Product blend override is applied in `resolveEngineBlendForRenderTarget` (not merged into `settings.blend` here).
 */
export function resolveEffectiveRenderTargetSettings(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey
): { settings: RpRenderTargetSettings; qa: ResolveRenderTargetSettingsQa } {
  const styleCode = String(blank.styleCode || "");
  const rows = (blank.placements ?? []) as PlacementRowLike[];
  const persisted = blank.renderProfile?.renderTargets;
  const blankHad = Boolean(persisted?.[target] && typeof persisted[target] === "object");
  const vid = variant?.variantId;
  const byColor = vid ? blank.renderProfile?.renderTargetsByColor?.[vid] : undefined;
  const colorMatrixCell = byColor?.[target];
  const colorMatrixCellExisted = Boolean(colorMatrixCell && typeof colorMatrixCell === "object");

  const baseMap = buildRenderTargetSettingsMap(persisted, rows, styleCode);
  let settings = baseMap[target];
  const side = renderTargetToSide(target);
  const pk = resolvePlacementKeyForRenderTarget(product, variant, target);
  const row = getPlacementRowForSide(blank, side, pk);
  const fallbackRow: PlacementRowLike = row
    ? {
        defaultScale: row.defaultScale ?? 0.6,
        defaultX: row.defaultX ?? 0.5,
        defaultY: row.defaultY ?? 0.5,
        view:
          row.view === "front" || row.view === "back"
            ? row.view
            : String(row.placementId || "").startsWith("back_")
              ? "back"
              : "front",
        renderZoneDefaults: row.renderZoneDefaults ?? null,
        simpleRenderControls8394: row.simpleRenderControls8394 ?? null,
      }
    : {
        defaultScale: 0.6,
        defaultX: 0.5,
        defaultY: 0.5,
        view: side,
        renderZoneDefaults: null,
        simpleRenderControls8394: null,
      };

  if (!settings) {
    settings = mergeRenderTargetSettings(
      getDefaultRenderTargetSettings(target, fallbackRow, styleCode),
      persisted?.[target]
    );
  }

  /**
   * Legacy per-color `variant.renderTargetOverrides` merges first, then
   * `renderTargetsByColor[variantId][target]` wins — matrix is authoritative for 8394 tuning.
   */
  const vSlice = variantSliceForRenderTarget(variant, target);
  settings = mergeRenderTargetSettings(
    settings,
    variantSliceToRenderTargetSettingsPatch(vSlice, fallbackRow, styleCode)
  );

  let primaryTuningLayer: RenderProfileTuningLayer = blankHad
    ? "blank_renderTargets"
    : "placement_defaults";
  if (colorMatrixCellExisted) {
    settings = mergeRenderTargetSettings(settings, colorMatrixCell!);
    primaryTuningLayer = "color_matrix";
  }

  const prodPatch = productPlacementToRenderTargetSettingsPatch(product, side);
  const productPlacementApplied = Boolean(prodPatch.placement && Object.keys(prodPatch.placement).length > 0);
  settings = mergeRenderTargetSettings(settings, prodPatch);

  return {
    settings,
    qa: {
      target,
      blankTuningExisted: blankHad,
      variantTargetOverrideExisted: variantRenderTargetSliceIsMeaningful(vSlice),
      productPlacementApplied,
      primaryTuningLayer,
      colorMatrixCellExisted,
    },
  };
}

/** Editor / preview: full map of effective tuning per target (blank + optional color variant overrides). */
export function buildEffectiveRenderTargetSettingsMap(
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined
): Record<RpRenderTarget, RpRenderTargetSettings> {
  const out = {} as Record<RpRenderTarget, RpRenderTargetSettings>;
  for (const t of RENDER_TARGETS) {
    const { settings } = resolveEffectiveRenderTargetSettings(null, blank, variant ?? null, t);
    out[t] = cloneRenderTargetSettings(settings);
  }
  return out;
}

/**
 * Sharp / compositor blend: start from resolved target tuning (`fabricFeel` / `printStrength` / `mode`), then apply
 * variant global `renderOverrides` and product / legacy blend overrides (same precedence as `resolveEffectiveRenderSettingsForRenderTarget`).
 */
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function resolveEngineBlendForRenderTarget(
  product: RpProduct | null | undefined,
  _blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTargetKey,
  tuningBlend: RpBlendSettings
): EffectiveRenderSettings {
  const side = renderTargetToSide(target);
  const styleCode = String(_blank.styleCode || "").trim();
  const fromTuning =
    styleCode === "8394"
      ? mapRealismToBlend(
          Math.round(clamp01(typeof tuningBlend.fabricFeel === "number" ? tuningBlend.fabricFeel : 0.52) * 100)
        )
      : blendSettingsToEngineBlend(tuningBlend);
  let modeRaw = fromTuning.blendMode;
  let opRaw = fromTuning.blendOpacity;
  let source: PlacementResolutionSource = "blank";

  const vo = variant?.renderOverrides;
  if (vo?.blendMode != null && String(vo.blendMode).trim()) modeRaw = vo.blendMode;
  if (vo?.blendOpacity != null && Number.isFinite(vo.blendOpacity)) opRaw = vo.blendOpacity;

  const ro: RpProductRenderOverrideSlice | null | undefined = product?.renderOverrides?.[side];
  if (ro && (ro.blendMode != null || ro.blendOpacity != null)) {
    if (ro.blendMode != null && String(ro.blendMode).trim()) modeRaw = ro.blendMode;
    if (ro.blendOpacity != null && Number.isFinite(ro.blendOpacity)) opRaw = ro.blendOpacity;
    source = "product_override";
  } else {
    const rsSide = side === "front" ? product?.renderSetup?.front : product?.renderSetup?.back;
    if (rsSide && (rsSide.blendMode != null || rsSide.blendOpacity != null)) {
      if (rsSide.blendMode != null && String(rsSide.blendMode).trim()) modeRaw = rsSide.blendMode;
      if (rsSide.blendOpacity != null && Number.isFinite(rsSide.blendOpacity)) opRaw = rsSide.blendOpacity;
      source = "legacy_render_setup";
    } else if (vo?.blendMode != null || vo?.blendOpacity != null) {
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

export function getPlacementFingerprintSliceForRenderTarget(
  blank: RPBlank,
  product: RpProduct | null | undefined,
  target: RpRenderTargetKey,
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
  targetTuningWarp?: RpRenderTargetSettings["warp"] | null;
  targetTuningMask?: RpRenderTargetSettings["mask"] | null;
} | null {
  const side = renderTargetToSide(target);
  const pk = resolvePlacementKeyForRenderTarget(product, variant ?? null, target);
  const row = getPlacementRowForSide(blank, side, pk);
  if (!row) return null;

  const eff = resolveEffectivePlacementForRenderTarget(product, blank, variant ?? null, target);
  if (!eff) return null;

  const mergedSimpleRaw = mergeSimple8394ForTarget(row, variant ?? null, target);
  const simple =
    mergedSimpleRaw != null ? normalizeSimpleControls8394(mergedSimpleRaw) : null;

  const tuning = resolveEffectiveRenderTargetSettings(product, blank, variant ?? null, target);
  const blendEff = resolveEngineBlendForRenderTarget(
    product,
    blank,
    variant ?? null,
    target,
    tuning.settings.blend
  );

  return {
    placementId: row.placementId,
    defaultX: tuning.settings.placement.x,
    defaultY: tuning.settings.placement.y,
    defaultScale: tuning.settings.placement.scale,
    safeArea: eff.safeArea,
    artboardBase: eff.artboardBase,
    renderZoneDefaults: { blendMode: blendEff.blendMode, blendOpacity: blendEff.blendOpacity },
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
    targetTuningWarp: tuning.settings.warp ?? null,
    targetTuningMask: tuning.settings.mask ?? null,
  };
}
