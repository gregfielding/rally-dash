/**
 * Raster artwork tone: which design asset slot to use (light / dark / white garment artwork).
 * Driven by blank variant `preferredArtworkTone` and garment color family, with deterministic fallbacks.
 */

import type { RPBlankArtworkTone, RPBlankColorFamily } from "@/lib/types/firestore";

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

/** Same resolution as `pickRasterUrlForVariant`, for SVG/PDF triples on a side. */
export function pickAssetUrlForVariant(
  triple: ToneTriple,
  garmentColorFamily: RPBlankColorFamily,
  preferredArtworkTone: RPBlankArtworkTone | null | undefined
): { url: string | null; ref: ArtworkToneSlot | null } {
  const u: SideRasterUrls = {
    lightPng: triple.light,
    darkPng: triple.dark,
    whitePng: triple.white,
  };
  return pickRasterUrlForVariant(u, garmentColorFamily, preferredArtworkTone);
}

function slotUrl(u: SideRasterUrls, tone: ArtworkToneSlot): string | null {
  if (tone === "light") return u.lightPng && String(u.lightPng).trim() ? String(u.lightPng).trim() : null;
  if (tone === "dark") return u.darkPng && String(u.darkPng).trim() ? String(u.darkPng).trim() : null;
  return u.whitePng && String(u.whitePng).trim() ? String(u.whitePng).trim() : null;
}

/**
 * Resolve which raster URL to use for a blank variant.
 * 1. If `preferredArtworkTone` is set, try that tone first, then follow its fallback chain.
 * 2. Otherwise use garment-family default chain.
 */
export function pickRasterUrlForVariant(
  u: SideRasterUrls,
  garmentColorFamily: RPBlankColorFamily,
  preferredArtworkTone: RPBlankArtworkTone | null | undefined
): { url: string | null; ref: ArtworkToneSlot | null } {
  const pref =
    preferredArtworkTone === "light" || preferredArtworkTone === "dark" || preferredArtworkTone === "white"
      ? preferredArtworkTone
      : null;

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
    return {
      blendMode: "screen",
      blendOpacity: Math.min(1, op * 1.08),
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
