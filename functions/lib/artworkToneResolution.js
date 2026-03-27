"use strict";

/**
 * Mirrors lib/designs/artworkToneResolution.ts — deterministic artwork tone chains for PNG/SVG/PDF picks.
 */

function fallbackChainForPreferredTone(preferred) {
  if (preferred === "white") return ["white", "dark", "light"];
  if (preferred === "dark") return ["dark", "white", "light"];
  return ["light", "white", "dark"];
}

function fallbackChainForGarmentFamily(garmentColorFamily) {
  if (garmentColorFamily === "dark") return ["light", "white", "dark"];
  return ["dark", "white", "light"];
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

module.exports = {
  fallbackChainForPreferredTone,
  fallbackChainForGarmentFamily,
  pickRasterUrlForVariant,
  resolveBackRenderTreatment,
};
