/**
 * QA / dashboard only: resolved 8394 realism pair + engine curve outputs.
 * Kept separate from `simpleRenderControls8394` for a stable barrel export.
 */

import {
  mapInkStrengthToFactors,
  mapRealismToBlend,
  normalizeSimpleControls8394,
} from "./simpleRenderControls8394";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function get8394EngineQaMetrics(fabricFeel01: number, printStrength01: number): {
  realism0to100: number;
  inkStrength0to100: number;
  effectiveBlendOpacity: number;
  effectiveInkMultiplier: number;
  blendMode: string;
} {
  const simple = normalizeSimpleControls8394({
    realism: Math.round(clamp(fabricFeel01, 0, 1) * 100),
    inkStrength: Math.round(clamp(printStrength01, 0, 1) * 100),
  });
  const { blendMode, blendOpacity } = mapRealismToBlend(simple.realism);
  const { designOpacityMultiplier } = mapInkStrengthToFactors(simple.inkStrength);
  return {
    realism0to100: simple.realism,
    inkStrength0to100: simple.inkStrength,
    effectiveBlendOpacity: blendOpacity,
    effectiveInkMultiplier: designOpacityMultiplier,
    blendMode,
  };
}
