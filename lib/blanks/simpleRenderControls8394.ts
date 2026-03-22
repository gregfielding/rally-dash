/**
 * 8394 back MVP: non-designer controls → engine params (blend, opacity, ink, scale).
 * UI exposes sliders/presets only; Firestore stores `simpleRenderControls8394` + derived `renderZoneDefaults`.
 */

import type { RP8394SizePreset, RPPlacementSimpleRenderControls8394 } from "@/lib/types/firestore";

export const DEFAULT_SIMPLE_RENDER_CONTROLS_8394 = {
  realism: 55,
  inkStrength: 78,
  sizePreset: "medium" as RP8394SizePreset,
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Size preset → defaultScale (canonical placement scale). */
export function sizePresetToDefaultScale(preset: RP8394SizePreset | string | null | undefined): number {
  switch (preset) {
    case "small":
      return 0.38;
    case "medium":
      return 0.58;
    case "large":
      return 0.78;
    case "fill_safe":
      return 0.98;
    default:
      return 0.58;
  }
}

/**
 * Realism 0 = looks like a sticker on top; 100 = more integrated into the garment.
 * Maps to blend mode + base layer opacity (before ink).
 */
export function mapRealismToBlend(realism: number): { blendMode: string; blendOpacity: number } {
  const r = clamp(realism, 0, 100);
  let blendMode: string;
  if (r < 28) blendMode = "normal";
  else if (r < 52) blendMode = "soft-light";
  else if (r < 76) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  const blendOpacity = clamp(1 - t * 0.26, 0.62, 1);
  return { blendMode, blendOpacity };
}

/**
 * Ink strength: faint print → bold print. Applied as extra multiplier on design alpha + contrast hint in preview.
 */
export function mapInkStrengthToFactors(inkStrength: number): {
  designOpacityMultiplier: number;
  contrastPercent: number;
} {
  const i = clamp(inkStrength, 0, 100) / 100;
  const designOpacityMultiplier = clamp(0.38 + 0.62 * i, 0.2, 1);
  const contrastPercent = clamp(88 + i * 32, 88, 125);
  return { designOpacityMultiplier, contrastPercent };
}

export function normalizeSimpleControls8394(
  raw: RPPlacementSimpleRenderControls8394 | null | undefined
): {
  realism: number;
  inkStrength: number;
  sizePreset: RP8394SizePreset;
} {
  const r = Number(raw?.realism ?? DEFAULT_SIMPLE_RENDER_CONTROLS_8394.realism);
  const ink = Number(raw?.inkStrength ?? DEFAULT_SIMPLE_RENDER_CONTROLS_8394.inkStrength);
  const presets: RP8394SizePreset[] = ["small", "medium", "large", "fill_safe"];
  const sp = raw?.sizePreset;
  const sizePreset: RP8394SizePreset =
    sp && presets.includes(sp as RP8394SizePreset) ? (sp as RP8394SizePreset) : DEFAULT_SIMPLE_RENDER_CONTROLS_8394.sizePreset;
  return {
    realism: clamp(Math.round(Number.isFinite(r) ? r : DEFAULT_SIMPLE_RENDER_CONTROLS_8394.realism), 0, 100),
    inkStrength: clamp(Math.round(Number.isFinite(ink) ? ink : DEFAULT_SIMPLE_RENDER_CONTROLS_8394.inkStrength), 0, 100),
    sizePreset,
  };
}

/** Derive stored `renderZoneDefaults` + `defaultScale` for Sharp / fingerprint. */
export function derivePlacementEngineFields8394(
  simple: RPPlacementSimpleRenderControls8394 | null | undefined
): {
  defaultScale: number;
  renderZoneDefaults: { blendMode: string; blendOpacity: number };
  designOpacityMultiplier: number;
  contrastPercent: number;
} {
  const n = normalizeSimpleControls8394(simple);
  const { blendMode, blendOpacity } = mapRealismToBlend(n.realism);
  const { designOpacityMultiplier, contrastPercent } = mapInkStrengthToFactors(n.inkStrength);
  return {
    defaultScale: sizePresetToDefaultScale(n.sizePreset),
    renderZoneDefaults: { blendMode, blendOpacity },
    designOpacityMultiplier,
    contrastPercent,
  };
}

/** Best-effort inverse when legacy rows only had renderZoneDefaults + scale. */
export function inferSimpleControls8394FromLegacy(
  defaultScale: number,
  renderZoneDefaults: { blendMode?: string | null; blendOpacity?: number | null } | null | undefined
): RPPlacementSimpleRenderControls8394 {
  const mode = String(renderZoneDefaults?.blendMode || "multiply").toLowerCase();
  const op = renderZoneDefaults?.blendOpacity;
  const opacity = typeof op === "number" && Number.isFinite(op) ? clamp(op, 0, 1) : 0.88;

  let realism = 55;
  if (mode === "normal") realism = 18;
  else if (mode === "soft-light") realism = 40;
  else if (mode === "overlay") realism = 64;
  else if (mode === "multiply") realism = 82;
  realism = clamp(Math.round(realism + (1 - opacity) * 35), 0, 100);

  const inkStrength = clamp(Math.round(opacity * 92 + (mode === "multiply" ? 6 : 0)), 0, 100);

  let sizePreset: RP8394SizePreset = "medium";
  if (defaultScale < 0.46) sizePreset = "small";
  else if (defaultScale < 0.68) sizePreset = "medium";
  else if (defaultScale < 0.9) sizePreset = "large";
  else sizePreset = "fill_safe";

  return { realism, inkStrength, sizePreset };
}
