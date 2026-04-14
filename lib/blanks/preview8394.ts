/**
 * Browser-only 8394 blank render profile preview helpers.
 * Intentionally stronger / wider curves than `simpleRenderControls8394` (Sharp/compositor) so operators
 * see slider movement in the dashboard; production pipelines keep using `mapRealismToBlend` / `mapInkStrengthToFactors`.
 */

import type { CSSProperties } from "react";
import type { RpMaskSettings, RpRenderTarget, RpWarpSettings } from "@/lib/types/firestore";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Preview curve: fabric feel 0–100 → blend mode + layer opacity with a **wide** opacity swing so
 * “more fabric” reads as more integration (lower sticker-like opacity at high realism).
 */
export function mapRealismToBlendPreview(realism0to100: number): { blendMode: string; blendOpacity: number } {
  const r = clamp(realism0to100, 0, 100);
  let blendMode: string;
  if (r < 22) blendMode = "normal";
  else if (r < 46) blendMode = "soft-light";
  else if (r < 70) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  /** Lower bound ~0.44 at high realism (more garment show-through), up to ~0.96 at low realism (crisper ink). */
  const blendOpacity = clamp(0.44 + (1 - t) * 0.52, 0.4, 0.97);
  return { blendMode, blendOpacity };
}

/**
 * Preview-only ink response: bolder contrast/saturation range than engine `mapInkStrengthToFactors`.
 */
export function mapInkStrengthToFactorsPreview(ink0to100: number): {
  designOpacityMultiplier: number;
  contrastPercent: number;
  saturatePercent: number;
} {
  const i = clamp(ink0to100, 0, 100) / 100;
  return {
    designOpacityMultiplier: clamp(0.18 + 0.82 * i, 0.12, 1),
    contrastPercent: clamp(64 + i * 58, 58, 132),
    saturatePercent: clamp(86 + i * 34, 80, 132),
  };
}

/** Nudge saturation vs fabric feel so high “fabric” reads slightly more “in the cloth”. */
export function fabricFeelToSaturatePercent(fabricFeel01: number): number {
  const f = clamp(fabricFeel01, 0, 1);
  const delta = (f - 0.5) * 26;
  return clamp(100 + delta, 78, 118);
}

/**
 * CSS 3D + skew approximation for dashboard preview. Production may use mesh warp in Sharp.
 * `model_back` gets extra curvature so the overlay breaks the “flat rectangle on body” look.
 */
export function build8394PreviewWarpTransform(warp: RpWarpSettings | undefined, target: RpRenderTarget): string {
  if (!warp?.enabled) return "";
  const rawWs = warp.warpStrength;
  const ws = clamp(typeof rawWs === "number" && Number.isFinite(rawWs) ? rawWs : 0.35, 0, 2);
  const vs = clamp(warp.verticalStretch ?? 0, -1, 1);
  const hw = clamp(warp.horizontalWarp ?? 0, -1, 1);

  const modelBoost = target === "model_back" ? 1.55 : target === "model_front" ? 1.2 : 1;
  const flatAtten = target === "flat_back" || target === "flat_front" ? 0.78 : 1;
  const k = ws * modelBoost * flatAtten;

  const rotX = -12 * k * (0.65 + Math.abs(vs) * 0.35);
  const rotY = hw * 11 * k;
  const skewX = hw * 12 * k;
  const scaleY = 1 + vs * 0.16 * k + k * 0.06;
  const scaleX = 1 - k * 0.1 + hw * 0.05 * k;
  const persp = 480 + Math.min(520, 340 * k);

  return `perspective(${persp}px) rotateX(${rotX}deg) rotateY(${rotY}deg) skewX(${skewX}deg) scale(${scaleX}, ${scaleY})`;
}

/**
 * Radial mask softening design edges (preview). Stronger than subtle engine defaults when sliders move.
 */
export function build8394PreviewMaskCss(mask: RpMaskSettings | undefined): CSSProperties {
  if (!mask?.enabled) return {};
  const feather = clamp(mask.feather ?? 0.08, 0, 1);
  const edgeFade = clamp(mask.edgeFade ?? 0.12, 0, 1);
  const inner = 22 + (1 - edgeFade) * 48;
  const softBand = 10 + feather * 42;
  const mid = Math.min(94, inner + softBand);
  const cy = 48 + edgeFade * 5;
  const grad = `radial-gradient(ellipse 93% 95% at 50% ${cy}%, #000 ${inner}%, rgba(0,0,0,0.82) ${mid}%, transparent 100%)`;
  return {
    WebkitMaskImage: grad,
    maskImage: grad,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}
