"use strict";

/**
 * Mirrors lib/designs/artworkToneResolution.ts — deterministic artwork tone chains for PNG/SVG/PDF picks.
 */

function fallbackChainForPreferredTone(preferred) {
  if (preferred === "white") return ["white", "dark", "light"];
  if (preferred === "dark") return ["dark", "white", "light"];
  return ["light", "white", "dark"];
}

/** Garment-matched slots: dark garment → darkPng first; light garment → lightPng first (see `lib/designs/artworkToneResolution.ts`). */
function fallbackChainForGarmentFamily(garmentColorFamily) {
  if (garmentColorFamily === "dark") return ["dark", "white", "light"];
  return ["light", "white", "dark"];
}

function slotUrl(u, tone) {
  if (tone === "light") return u.lightPng && String(u.lightPng).trim() ? String(u.lightPng).trim() : null;
  if (tone === "dark") return u.darkPng && String(u.darkPng).trim() ? String(u.darkPng).trim() : null;
  return u.whitePng && String(u.whitePng).trim() ? String(u.whitePng).trim() : null;
}

function pickRasterUrlForVariant(u, garmentColorFamily, preferredArtworkTone) {
  const pref =
    preferredArtworkTone === "light" || preferredArtworkTone === "dark" || preferredArtworkTone === "white"
      ? preferredArtworkTone
      : null;
  const chain = pref ? fallbackChainForPreferredTone(pref) : fallbackChainForGarmentFamily(garmentColorFamily);
  for (const tone of chain) {
    const url = slotUrl(u, tone);
    if (url) return { url, ref: tone };
  }
  return { url: null, ref: null };
}

/**
 * Mirrors lib/designs/artworkToneResolution.ts `resolveBackRenderTreatment`.
 */
function resolveBackRenderTreatment(garmentFamily, resolvedTone) {
  const t = resolvedTone || "dark";
  if (garmentFamily === "dark") {
    if (t === "light" || t === "white") return "clean";
    return "blended";
  }
  if (t === "dark") return "blended";
  if (t === "white" || t === "light") return "clean";
  return "blended";
}

/**
 * Mirrors `lib/designs/artworkToneResolution.ts` `resolveBlendedPreviewBlend8394`.
 * Official Sharp composite uses the same adjustment as the blank editor blended preview.
 */
function resolveBlendedPreviewBlend8394(garmentFamily, previewArtworkMode, baseZoneBlend) {
  const op = baseZoneBlend.blendOpacity;
  const t = previewArtworkMode || "dark";

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

/**
 * Tone-only artwork URLs (no `assets.front` / `assets.back` nesting).
 * Matches Firestore where `assets.lightPng`, `assets.darkPng`, `assets.whitePng` (and optional `files.*Png.downloadUrl`) hold the art.
 */
function resolveToneBasedDesignAssetUrls(design) {
  const a = (design && design.assets) || {};
  const f = (design && design.files) || {};
  const trim = (x) => (x != null && String(x).trim() ? String(x).trim() : null);
  return {
    lightPng: trim(a.lightPng) || trim(f.lightPng && f.lightPng.downloadUrl) || null,
    darkPng: trim(a.darkPng) || trim(f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: trim(a.whitePng) || trim(f.whitePng && f.whitePng.downloadUrl) || null,
  };
}

/**
 * Which field supplied the winning URL (for diagnostics).
 * @param {string} tone — "light" | "dark" | "white"
 */
function describeToneSourcePath(design, tone, resolvedUrl) {
  if (!resolvedUrl) return null;
  const u = String(resolvedUrl).trim();
  const a = (design && design.assets) || {};
  const f = (design && design.files) || {};
  const key = tone === "light" ? "lightPng" : tone === "dark" ? "darkPng" : "whitePng";
  if (a[key] != null && String(a[key]).trim() === u) return `assets.${key}`;
  const node = f[key];
  if (node && node.downloadUrl != null && String(node.downloadUrl).trim() === u) return `files.${key}.downloadUrl`;
  return "unknown";
}

/**
 * Which nested **back** field supplied the URL (same resolution as `pickDesignPngForVariant` / MVP flat back).
 */
function describeBackSideAssetSourcePath(design, tone, resolvedUrl) {
  if (!resolvedUrl || !tone) return null;
  const u = String(resolvedUrl).trim();
  const a = (design && design.assets && design.assets.back) || {};
  const f = (design && design.files && design.files.back) || {};
  const key = tone === "light" ? "lightPng" : tone === "dark" ? "darkPng" : "whitePng";
  if (a[key] != null && String(a[key]).trim() === u) return `assets.back.${key}`;
  const node = f[key];
  if (node && node.downloadUrl != null && String(node.downloadUrl).trim() === u) return `files.back.${key}.downloadUrl`;
  return describeToneSourcePath(design, tone, resolvedUrl);
}

/**
 * Pick design PNG from tone slots only (blank/garment drives side; design supplies art by tone).
 * @returns {{ url: string | null, resolvedTone: string | null, sourcePathUsed: string | null }}
 */
function resolveDesignArtworkUrlByToneOnly(design, garmentColorFamily, preferredArtworkTone) {
  const urls = resolveToneBasedDesignAssetUrls(design);
  const picked = pickRasterUrlForVariant(urls, garmentColorFamily, preferredArtworkTone);
  const url = picked.url;
  const resolvedTone = picked.ref || null;
  const sourcePathUsed =
    url && resolvedTone ? describeToneSourcePath(design, resolvedTone, url) : null;
  return { url, resolvedTone, sourcePathUsed };
}

module.exports = {
  fallbackChainForPreferredTone,
  fallbackChainForGarmentFamily,
  pickRasterUrlForVariant,
  resolveBackRenderTreatment,
  resolveBlendedPreviewBlend8394,
  resolveToneBasedDesignAssetUrls,
  describeToneSourcePath,
  describeBackSideAssetSourcePath,
  resolveDesignArtworkUrlByToneOnly,
};
