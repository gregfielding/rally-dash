/**
 * Resolve effective placement / render settings for a product.
 *
 * **Hierarchy (canonical):**
 * 1. Blank `placements[]` + blank `renderDefaults` + variant `renderOverrides` = defaults
 * 2. Product `placementOverrides` / `renderOverrides` = optional SKU-specific overrides only
 * 3. Legacy `renderSetup.*.placementOverride` and `renderSetup.*.blendMode` = treated as overrides for backward compatibility
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
} from "@/lib/types/firestore";
import { DEFAULT_GARMENT_SAFE_AREA } from "@/lib/render/designArtboardSpec";
import { normalizeSimpleControls8394, derivePlacementEngineFields8394 } from "@/lib/blanks/simpleRenderControls8394";

export type PlacementResolutionSource = "blank" | "product_override" | "legacy_render_setup";

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

/**
 * Effective placement for mockups, previews, and fingerprints.
 * Order: structured `placementOverrides` → legacy `renderSetup.*.placementOverride` → blank row.
 */
export function resolveEffectivePlacement(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  side: "front" | "back"
): EffectivePlacement | null {
  const placementKey =
    (side === "front"
      ? product?.renderSetup?.front?.placementKey
      : product?.renderSetup?.back?.placementKey) ?? null;
  const row = getPlacementRowForSide(blank, side, placementKey);
  if (!row) return null;

  const baseX = row.defaultX ?? 0.5;
  const baseY = row.defaultY ?? 0.5;
  const baseScale = row.defaultScale ?? 0.6;
  const baseSafe = row.safeArea ?? { ...DEFAULT_GARMENT_SAFE_AREA };
  const artboardBase =
    row.artboardBase != null && Number.isFinite(Number(row.artboardBase)) ? Number(row.artboardBase) : 0.5;

  const structured = readStructuredPlacementOverride(product, side);
  const legacy = readLegacyPlacementOverride(product, side);

  let source: PlacementResolutionSource = "blank";
  let defaultX = baseX;
  let defaultY = baseY;
  let defaultScale = baseScale;
  let safeArea = { ...baseSafe };

  if (structured) {
    if (structured.defaultX != null) defaultX = structured.defaultX;
    if (structured.defaultY != null) defaultY = structured.defaultY;
    if (structured.defaultScale != null) defaultScale = structured.defaultScale;
    safeArea = mergeSafeArea(baseSafe, structured.safeArea);
    source = "product_override";
  } else if (legacy) {
    if (legacy.x != null) defaultX = legacy.x;
    if (legacy.y != null) defaultY = legacy.y;
    if (legacy.scale != null) defaultScale = legacy.scale;
    source = "legacy_render_setup";
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
 * Effective blend for a side: variant + zone + blank defaults, then product `renderOverrides`, then legacy `renderSetup.*`.
 */
export function resolveEffectiveRenderSettings(
  product: RpProduct | null | undefined,
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  placementRow: RPPlacement | null,
  side: "front" | "back"
): EffectiveRenderSettings {
  const rd = blank.renderDefaults;
  const vo = variant?.renderOverrides;
  const derivedFromSimple =
    placementRow?.simpleRenderControls8394 != null
      ? derivePlacementEngineFields8394(placementRow.simpleRenderControls8394).renderZoneDefaults
      : null;
  const zd = derivedFromSimple ?? placementRow?.renderZoneDefaults;
  const sideRd = side === "front" ? rd?.front : rd?.back;

  let modeRaw =
    vo?.blendMode ??
    zd?.blendMode ??
    sideRd?.blendMode ??
    rd?.blendMode ??
    "multiply";
  let opRaw =
    vo?.blendOpacity ?? zd?.blendOpacity ?? sideRd?.blendOpacity ?? rd?.blendOpacity ?? 1;

  let source: PlacementResolutionSource = "blank";

  const ro = product?.renderOverrides?.[side];
  if (ro && (ro.blendMode != null || ro.blendOpacity != null)) {
    if (ro.blendMode != null && String(ro.blendMode).trim()) {
      modeRaw = ro.blendMode;
    }
    if (ro.blendOpacity != null && Number.isFinite(ro.blendOpacity)) {
      opRaw = ro.blendOpacity;
    }
    source = "product_override";
  }

  const rsSide = side === "front" ? product?.renderSetup?.front : product?.renderSetup?.back;
  if (source === "blank" && rsSide && (rsSide.blendMode != null || rsSide.blendOpacity != null)) {
    if (rsSide.blendMode != null && String(rsSide.blendMode).trim()) {
      modeRaw = rsSide.blendMode;
    }
    if (rsSide.blendOpacity != null && Number.isFinite(rsSide.blendOpacity)) {
      opRaw = rsSide.blendOpacity;
    }
    source = "legacy_render_setup";
  }

  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opacity =
    typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;

  return { blendMode: mode, blendOpacity: opacity, source };
}

/** Fingerprint slice for flat render / stale checks — uses **resolved** placement (blank + product). */
export function getPlacementFingerprintSliceForProduct(
  blank: RPBlank,
  product: RpProduct | null | undefined,
  side: "front" | "back"
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
  const row = getPlacementRowForSide(
    blank,
    side,
    side === "front"
      ? product?.renderSetup?.front?.placementKey
      : product?.renderSetup?.back?.placementKey
  );
  if (!row) return null;

  const eff = resolveEffectivePlacement(product, blank, side);
  if (!eff) return null;

  const simple =
    row.simpleRenderControls8394 != null ? normalizeSimpleControls8394(row.simpleRenderControls8394) : null;

  return {
    placementId: row.placementId,
    defaultX: eff.defaultX,
    defaultY: eff.defaultY,
    defaultScale: eff.defaultScale,
    safeArea: eff.safeArea,
    artboardBase: eff.artboardBase,
    renderZoneDefaults: row.renderZoneDefaults ?? null,
    simpleRenderControls8394: simple
      ? { realism: simple.realism, inkStrength: simple.inkStrength, sizePreset: simple.sizePreset }
      : null,
  };
}
