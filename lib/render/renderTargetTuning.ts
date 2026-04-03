/**
 * Per-render-target tuning (`RPBlank.renderProfile.renderTargets`) — shared helpers.
 * Zone geometry stays on `RPBlank.placements[]`.
 */

import type { RPBlank, RPBlankVariant, RPBlankVariantRenderProfileSideOverride } from "@/lib/types/firestore";
import type {
  RpBlendSettings,
  RpMaskSettings,
  RpPlacementSettings,
  RpRenderTarget,
  RpRenderTargetSettings,
  RpWarpSettings,
} from "@/lib/types/firestore";
import {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} from "@/lib/blanks/variantRenderSources";

export const RENDER_TARGETS: readonly RpRenderTarget[] = [
  "flat_front",
  "flat_back",
  "model_front",
  "model_back",
];

export const RENDER_TARGET_LABELS: Record<RpRenderTarget, string> = {
  flat_front: "Flat Front",
  flat_back: "Flat Back",
  model_front: "Model Front",
  model_back: "Model Back",
};

/** Row shape needed to seed defaults (matches blank render profile editor `ProfileRow`). */
export type PlacementRowLike = {
  defaultScale: number;
  defaultX: number;
  defaultY: number;
  view: "front" | "back";
  renderZoneDefaults?: { blendMode?: string | null; blendOpacity?: number | null } | null;
  simpleRenderControls8394?: { realism?: number | null; inkStrength?: number | null } | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function defaultWarp(): RpWarpSettings {
  return { enabled: false, warpStrength: 0.35, verticalStretch: 0, horizontalWarp: 0 };
}

function defaultMask(): RpMaskSettings {
  return { enabled: false, feather: 0.08, edgeFade: 0.12 };
}

/** Map legacy zone `renderZoneDefaults` to 0–1 fabric / print strength (matches `rowToBlend01` curve). */
export function legacyZoneBlendToBlend01(z: {
  blendMode?: string | null;
  blendOpacity?: number | null;
} | null | undefined): Partial<RpBlendSettings> {
  if (!z || (z.blendMode == null && z.blendOpacity == null)) return {};
  const op = typeof z.blendOpacity === "number" && Number.isFinite(z.blendOpacity) ? z.blendOpacity : 0.85;
  const mode = String(z.blendMode || "multiply").toLowerCase();
  let fabricFeelPct = 75;
  if (mode === "normal") fabricFeelPct = 12;
  else if (mode === "soft-light") fabricFeelPct = 38;
  else if (mode === "overlay") fabricFeelPct = 58;
  const printStrengthPct = clamp(Math.round(((op - 0.35) / 0.65) * 100), 0, 100);
  return { fabricFeel: fabricFeelPct / 100, printStrength: printStrengthPct / 100 };
}

function rowToBlend01(row: PlacementRowLike, styleCode: string): RpBlendSettings {
  const sc = String(styleCode || "").trim();
  if (sc === "8394" && row.view === "back" && row.simpleRenderControls8394) {
    const r = row.simpleRenderControls8394.realism ?? 55;
    const i = row.simpleRenderControls8394.inkStrength ?? 78;
    return {
      fabricFeel: clamp(r, 0, 100) / 100,
      printStrength: clamp(i, 0, 100) / 100,
    };
  }
  const z = row.renderZoneDefaults;
  const op = typeof z?.blendOpacity === "number" && Number.isFinite(z.blendOpacity) ? z.blendOpacity : 0.85;
  const mode = String(z?.blendMode || "multiply").toLowerCase();
  let fabricFeelPct = 75;
  if (mode === "normal") fabricFeelPct = 12;
  else if (mode === "soft-light") fabricFeelPct = 38;
  else if (mode === "overlay") fabricFeelPct = 58;
  const printStrengthPct = clamp(Math.round(((op - 0.35) / 0.65) * 100), 0, 100);
  return { fabricFeel: fabricFeelPct / 100, printStrength: printStrengthPct / 100 };
}

/**
 * Defaults for a render target: placement + blend derived from the best-matching zone row.
 */
export function getDefaultRenderTargetSettings(
  target: RpRenderTarget,
  row: PlacementRowLike,
  styleCode: string
): RpRenderTargetSettings {
  const placement: RpPlacementSettings = {
    scale: row.defaultScale,
    x: row.defaultX,
    y: row.defaultY,
  };
  const blend = rowToBlend01(row, styleCode);
  return {
    placement,
    blend,
    warp: defaultWarp(),
    mask: defaultMask(),
  };
}

export function pickRowForRenderTarget(rows: PlacementRowLike[], target: RpRenderTarget): PlacementRowLike | null {
  if (!rows.length) return null;
  const wantBack = target === "flat_back" || target === "model_back";
  const hit = rows.find((x) => x.view === (wantBack ? "back" : "front"));
  return hit ?? rows[0] ?? null;
}

export function cloneRenderTargetSettings(s: RpRenderTargetSettings): RpRenderTargetSettings {
  return {
    placement: { ...s.placement },
    blend: { ...s.blend },
    warp: s.warp ? { ...s.warp } : defaultWarp(),
    mask: s.mask ? { ...s.mask } : defaultMask(),
  };
}

/**
 * Deep-enough merge for editor + server patches. `patch` wins for provided nested fields.
 */
export function mergeRenderTargetSettings(
  base: RpRenderTargetSettings,
  patch: Partial<RpRenderTargetSettings> | undefined
): RpRenderTargetSettings {
  if (!patch) return cloneRenderTargetSettings(base);
  const placement: RpPlacementSettings = {
    ...base.placement,
    ...patch.placement,
  };
  const blend: RpBlendSettings = {
    ...base.blend,
    ...patch.blend,
  };
  const warp: RpWarpSettings = {
    ...defaultWarp(),
    ...base.warp,
    ...patch.warp,
  };
  const mask: RpMaskSettings = {
    ...defaultMask(),
    ...base.mask,
    ...patch.mask,
  };
  return { placement, blend, warp, mask };
}

export function buildRenderTargetSettingsMap(
  persisted: Partial<Record<RpRenderTarget, RpRenderTargetSettings>> | undefined | null,
  rows: PlacementRowLike[],
  styleCode: string
): Record<RpRenderTarget, RpRenderTargetSettings> {
  const out = {} as Record<RpRenderTarget, RpRenderTargetSettings>;
  for (const t of RENDER_TARGETS) {
    const row = pickRowForRenderTarget(rows, t);
    if (!row) continue;
    const base = getDefaultRenderTargetSettings(t, row, styleCode);
    const saved = persisted?.[t];
    out[t] = saved ? mergeRenderTargetSettings(base, saved) : cloneRenderTargetSettings(base);
  }
  return out;
}

export function renderTargetToGarmentSide(target: RpRenderTarget): "front" | "back" {
  return target === "flat_back" || target === "model_back" ? "back" : "front";
}

/**
 * Preview garment URL for a render target + variant (flat slots fall back to legacy front/back).
 */
export function getRenderTargetPreviewUrl(
  blank: RPBlank,
  variant: RPBlankVariant | null | undefined,
  target: RpRenderTarget
): string | null {
  if (!variant) return null;
  switch (target) {
    case "flat_front":
      return getVariantFlatFrontUrl(blank, variant);
    case "flat_back":
      return getVariantFlatBackUrl(blank, variant);
    case "model_front":
      return getVariantModelFrontUrl(blank, variant);
    case "model_back":
      return getVariantModelBackUrl(blank, variant);
    default:
      return null;
  }
}

export function defaultRenderTargetForZoneView(view: "front" | "back"): RpRenderTarget {
  return view === "back" ? "flat_back" : "flat_front";
}

/** Map 0–1 blend fields to canvas mix-blend + opacity (matches blank editor zone custom curve). */
export function blend01ToPreviewCss(blend: RpBlendSettings): { blendMode: string; blendOpacity: number } {
  const pf = clamp(blend.fabricFeel, 0, 1);
  const ps = clamp(blend.printStrength, 0, 1);
  const blendOpacity = clamp(0.35 + ps * 0.65, 0.3, 1);
  let blendMode = "multiply";
  if (pf < 0.28) blendMode = "normal";
  else if (pf < 0.5) blendMode = "soft-light";
  else if (pf < 0.72) blendMode = "overlay";
  else blendMode = "multiply";
  const opacityAdjust = blendOpacity * (0.7 + (1 - pf) * 0.3);
  return { blendMode, blendOpacity: clamp(opacityAdjust, 0.28, 1) };
}

/** Uses `blend.mode` as a hint when set (engines may interpret differently). */
export function blendSettingsToPreviewCss(blend: RpBlendSettings): { blendMode: string; blendOpacity: number } {
  const base = blend01ToPreviewCss(blend);
  if (!blend.mode) return base;
  const map: Record<NonNullable<RpBlendSettings["mode"]>, string> = {
    clean: "normal",
    soft: "soft-light",
    vintage: "multiply",
    bold: "normal",
  };
  const m = map[blend.mode];
  return m ? { ...base, blendMode: m } : base;
}

/** Alias for compositor / Sharp — same mapping as preview CSS. */
export function blendSettingsToEngineBlend(blend: RpBlendSettings): { blendMode: string; blendOpacity: number } {
  return blendSettingsToPreviewCss(blend);
}

/**
 * Maps variant `renderTargetOverrides[target]` slice into partial `RpRenderTargetSettings` (merged after blank tuning).
 */
export function variantSliceToRenderTargetSettingsPatch(
  slice: RPBlankVariantRenderProfileSideOverride | null | undefined,
  row: PlacementRowLike,
  styleCode: string
): Partial<RpRenderTargetSettings> {
  if (!slice) return {};
  const patch: Partial<RpRenderTargetSettings> = {};
  if (slice.defaultX != null || slice.defaultY != null || slice.defaultScale != null) {
    patch.placement = {
      scale: slice.defaultScale ?? row.defaultScale,
      x: slice.defaultX ?? row.defaultX,
      y: slice.defaultY ?? row.defaultY,
    };
  }
  const sc = String(styleCode || "").trim();
  const blend: Partial<RpBlendSettings> = {};
  if (sc === "8394" && row.view === "back" && slice.simpleRenderControls8394) {
    const r = slice.simpleRenderControls8394.realism ?? 55;
    const i = slice.simpleRenderControls8394.inkStrength ?? 78;
    blend.fabricFeel = clamp(r, 0, 100) / 100;
    blend.printStrength = clamp(i, 0, 100) / 100;
  }
  if (
    slice.renderZoneDefaults &&
    (slice.renderZoneDefaults.blendMode != null || slice.renderZoneDefaults.blendOpacity != null)
  ) {
    Object.assign(blend, legacyZoneBlendToBlend01(slice.renderZoneDefaults));
  }
  if (Object.keys(blend).length) {
    patch.blend = blend as RpBlendSettings;
  }
  return patch;
}

export function variantRenderTargetSliceIsMeaningful(
  slice: RPBlankVariantRenderProfileSideOverride | null | undefined
): boolean {
  if (!slice || typeof slice !== "object") return false;
  return (
    slice.defaultX != null ||
    slice.defaultY != null ||
    slice.defaultScale != null ||
    (slice.safeArea != null && Object.keys(slice.safeArea).length > 0) ||
    (slice.simpleRenderControls8394 != null && Object.keys(slice.simpleRenderControls8394).length > 0) ||
    (slice.renderZoneDefaults != null &&
      (slice.renderZoneDefaults.blendMode != null || slice.renderZoneDefaults.blendOpacity != null)) ||
    (slice.placementKey != null && String(slice.placementKey).trim() !== "")
  );
}
