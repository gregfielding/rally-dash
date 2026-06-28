/**
 * Raster artwork tone: which design asset slot to use (light / dark / white garment artwork).
 * Driven by blank variant `preferredArtworkTone` and garment color family, with deterministic fallbacks.
 */

import type { RPBlankArtworkTone, RPBlankColorFamily } from "@/lib/types/firestore";
import { resolveEffectivePreferredTone } from "@/lib/blanks/colorTonePreferences";

export type ArtworkToneSlot = "light" | "dark" | "white";

/** URLs for one print side (PNG); SVG/PDF use parallel slot names. */
export type SideRasterUrls = {
  lightPng: string | null;
  darkPng: string | null;
  whitePng: string | null;
};

/**
 * Fallback order when a preferred tone is set (asset may be missing).
 * - white → dark → light
 * - dark → white → light
 * - light → white → dark
 */
export function fallbackChainForPreferredTone(preferred: RPBlankArtworkTone): ArtworkToneSlot[] {
  if (preferred === "white") return ["white", "dark", "light"];
  if (preferred === "dark") return ["dark", "white", "light"];
  return ["light", "white", "dark"];
}

/**
 * Default chain when `preferredArtworkTone` is null/undefined: garment family only.
 * Slots match **target garment** in Merch naming: `lightPng` for light garments, `darkPng` for dark garments,
 * then `white`, then remaining fallback.
 * - Dark garment → dark → white → light
 * - Light garment → light → white → dark
 */
export function fallbackChainForGarmentFamily(garmentColorFamily: RPBlankColorFamily): ArtworkToneSlot[] {
  if (garmentColorFamily === "dark") return ["dark", "white", "light"];
  return ["light", "white", "dark"];
}

/** Generic light / dark / white slots (PNG, SVG, or PDF URLs for one side). */
export type ToneTriple = {
  light: string | null;
  dark: string | null;
  white: string | null;
};

/**
 * Same resolution as `pickRasterUrlForVariant`, for SVG/PDF triples on a side.
 * Optional `colorName` lets the resolver apply the global color-name → tone map
 * (e.g. "Pink" → white) when no per-variant `preferredArtworkTone` is set.
 */
export function pickAssetUrlForVariant(
  triple: ToneTriple,
  garmentColorFamily: RPBlankColorFamily,
  preferredArtworkTone: RPBlankArtworkTone | null | undefined,
  colorName?: string | null
): { url: string | null; ref: ArtworkToneSlot | null } {
  const u: SideRasterUrls = {
    lightPng: triple.light,
    darkPng: triple.dark,
    whitePng: triple.white,
  };
  return pickRasterUrlForVariant(u, garmentColorFamily, preferredArtworkTone, colorName);
}

function slotUrl(u: SideRasterUrls, tone: ArtworkToneSlot): string | null {
  if (tone === "light") return u.lightPng && String(u.lightPng).trim() ? String(u.lightPng).trim() : null;
  if (tone === "dark") return u.darkPng && String(u.darkPng).trim() ? String(u.darkPng).trim() : null;
  return u.whitePng && String(u.whitePng).trim() ? String(u.whitePng).trim() : null;
}

/**
 * Resolve which raster URL to use for a blank variant.
 * 1. If `preferredArtworkTone` is set on the variant, try that tone first.
 * 2. Otherwise, if `colorName` matches a global color-name rule (e.g. "Pink" →
 *    white), use that tone first.
 * 3. Otherwise use the light/dark garment-family default chain.
 *
 * Pass `colorName` when you have it on hand — without it, step 2 is skipped
 * and the resolver behaves identically to the pre-rule version.
 */
export function pickRasterUrlForVariant(
  u: SideRasterUrls,
  garmentColorFamily: RPBlankColorFamily,
  preferredArtworkTone: RPBlankArtworkTone | null | undefined,
  colorName?: string | null
): { url: string | null; ref: ArtworkToneSlot | null } {
  const pref = resolveEffectivePreferredTone(colorName, preferredArtworkTone);

  const chain: ArtworkToneSlot[] = pref
    ? fallbackChainForPreferredTone(pref)
    : fallbackChainForGarmentFamily(garmentColorFamily);

  for (const tone of chain) {
    const url = slotUrl(u, tone);
    if (url) return { url, ref: tone };
  }
  return { url: null, ref: null };
}

export type BackRenderTreatment = "clean" | "blended";

/**
 * 8394 back flat output: fabric multiply blend vs crisp over-print.
 * - Dark garment + light/white artwork → clean (no heavy blend)
 * - Light garment + dark artwork → blended (normal fabric integration)
 * - Light + white → clean (keep white readable on fashion colors)
 */
export function resolveBackRenderTreatment(
  garmentFamily: RPBlankColorFamily,
  resolvedTone: ArtworkToneSlot | null | undefined
): BackRenderTreatment {
  const t = resolvedTone ?? "dark";
  if (garmentFamily === "dark") {
    if (t === "light" || t === "white") return "clean";
    return "blended";
  }
  if (t === "dark") return "blended";
  if (t === "white" || t === "light") return "clean";
  return "blended";
}

export type BlendedPreview8394Adjust = {
  blendMode: string;
  blendOpacity: number;
  /** True when preview blend differs from base realism curve so operators know browser ≠ Sharp 1:1. */
  previewAdjusted: boolean;
};

/**
 * 8394 render profile **browser** blended preview: `mix-blend-mode: multiply` matches the Sharp pipeline poorly for
 * dark-on-dark (mud) and white/light on dark (multiply wipes highlights). Align with `resolveBackRenderTreatment`:
 * clean-style comps use **normal**; dark ink on dark fabric uses **screen** as a legible stand-in for “fabric blended” dark ink.
 */
export function resolveBlendedPreviewBlend8394(
  garmentFamily: RPBlankColorFamily,
  previewArtworkMode: "light" | "dark" | "white",
  baseZoneBlend: { blendMode: string; blendOpacity: number }
): BlendedPreview8394Adjust {
  const op = baseZoneBlend.blendOpacity;
  const t = previewArtworkMode;

  if (garmentFamily === "dark") {
    if (t === "light" || t === "white") {
      return { blendMode: "normal", blendOpacity: Math.min(1, op), previewAdjusted: true };
    }
    /**
     * Colored ink on a dark/colored garment. Screen-print ink is OPAQUE → use "normal".
     * "screen" blended the GARMENT's color INTO the ink — orange on a blue garment came out
     * pink (orange red + garment blue = magenta); it only looked right on near-black because
     * screen-with-black ≈ identity. Normal keeps the ink's true color on any dark/colored
     * garment (the design PNG is transparent around the artwork). Near-opaque floor so a
     * saturated garment doesn't bleed through. Mirrors functions/lib/artworkToneResolution.js.
     */
    return {
      blendMode: "normal",
      blendOpacity: Math.min(1, Math.max(op * 1.08, 0.9)),
      previewAdjusted: true,
    };
  }

  if (t === "white" || t === "light") {
    return { blendMode: "normal", blendOpacity: op, previewAdjusted: true };
  }

  return {
    blendMode: baseZoneBlend.blendMode,
    blendOpacity: op,
    previewAdjusted: false,
  };
}
