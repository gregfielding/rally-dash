"use strict";

/**
 * Server mirror of `lib/designs/designHelpers.ts` `pickDesignPngUrlForVariant` + `describeDesignSidePngSourcePath`.
 * Must stay aligned with the blank render profile editor preview (blank variant row + `resolveDesignSideAssets`).
 */

const { pickRasterUrlForVariant } = require("./artworkToneResolution");

function resolveLegacyFlatAssetUrls(design) {
  if (!design) {
    return {
      lightPng: null,
      darkPng: null,
      whitePng: null,
    };
  }
  const a = design.assets || {};
  const f = design.files || {};
  return {
    lightPng: a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null,
    darkPng: a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null,
  };
}

function sideHasNestedPng(design, side) {
  const a = design.assets && design.assets[side];
  const f = design.files && design.files[side];
  return !!(
    (a && (a.lightPng || a.darkPng || a.whitePng)) ||
    (f && f.lightPng && f.lightPng.downloadUrl) ||
    (f && f.darkPng && f.darkPng.downloadUrl) ||
    (f && f.whitePng && f.whitePng.downloadUrl)
  );
}

function hasAnySideAwareAssets(design) {
  return sideHasNestedPng(design, "front") || sideHasNestedPng(design, "back");
}

function legacyFlatTargetsSide(design, side) {
  const flat = resolveLegacyFlatAssetUrls(design);
  const hasLegacy = !!(flat.lightPng || flat.darkPng || flat.whitePng);
  if (!hasLegacy || hasAnySideAwareAssets(design)) return false;

  const ss = (design.supportedSides || []).map((s) => String(s).trim().toLowerCase());
  if (ss.length === 1) {
    if (ss[0] === "front") return side === "front";
    if (ss[0] === "back") return side === "back";
  }
  if (ss.length === 0 || (ss.includes("front") && ss.includes("back"))) {
    return true;
  }
  return side === "back";
}

function resolveDesignSidePngsForPreview(design, side) {
  if (!design) {
    return { lightPng: null, darkPng: null, whitePng: null };
  }
  const a = design.assets && design.assets[side];
  const f = design.files && design.files[side];
  const pick = (slot) =>
    (a && a[slot]) || (f && f[slot] && f[slot].downloadUrl) || null;

  let lightPng = pick("lightPng");
  let darkPng = pick("darkPng");
  let whitePng = pick("whitePng");

  const flat = resolveLegacyFlatAssetUrls(design);
  if (legacyFlatTargetsSide(design, side)) {
    lightPng = lightPng != null ? lightPng : flat.lightPng;
    darkPng = darkPng != null ? darkPng : flat.darkPng;
    whitePng = whitePng != null ? whitePng : flat.whitePng;
  }

  return { lightPng, darkPng, whitePng };
}

const DARK = new Set([
  "black",
  "midnight navy",
  "navy",
  "indigo",
  "blue",
  "royal blue",
  "cobalt",
  "heather blue",
  "dark blue",
]);

function getEffectiveColorFamily(colorFamily, colorName) {
  const n = String(colorName || "")
    .trim()
    .toLowerCase();
  /**
   * A known-dark garment NAME (black/navy/indigo/blue/…) is ALWAYS the dark family for
   * render purposes — it overrides a mis-set `colorFamily`. The tank's "Black" variant was
   * saved as colorFamily="light", which routed the blend to the light-garment path
   * (multiply) → multiply(orange ink × black garment) ≈ muddy/maroon. Name wins for
   * known-dark colors; otherwise trust the explicit family, then default light.
   */
  if (DARK.has(n)) return "dark";
  if (colorFamily === "light" || colorFamily === "dark") return colorFamily;
  return "light";
}

/**
 * Same as `pickDesignPngUrlForVariant` / blank editor (blank **library** variant row only).
 */
function pickDesignPngUrlForBlankPreview(design, blankVariantRow, side) {
  const fam = getEffectiveColorFamily(blankVariantRow.colorFamily, blankVariantRow.colorName);
  const u = resolveDesignSidePngsForPreview(design, side);
  return pickRasterUrlForVariant(
    {
      lightPng: u.lightPng,
      darkPng: u.darkPng,
      whitePng: u.whitePng,
    },
    fam,
    blankVariantRow.preferredArtworkTone
  );
}

function describeDesignSidePngSourcePath(design, side, tone, resolvedUrl) {
  if (!resolvedUrl || !tone) return null;
  const u = String(resolvedUrl).trim();
  if (!u) return null;
  const a = design.assets && design.assets[side];
  const f = design.files && design.files[side];
  const key = tone === "light" ? "lightPng" : tone === "dark" ? "darkPng" : "whitePng";
  if (a && a[key] != null && String(a[key]).trim() === u) {
    return `assets.${side}.${key}`;
  }
  const node = f && f[key];
  if (node && node.downloadUrl != null && String(node.downloadUrl).trim() === u) {
    return `files.${side}.${key}.downloadUrl`;
  }
  const flat = resolveLegacyFlatAssetUrls(design);
  const leg = key === "light" ? flat.lightPng : key === "dark" ? flat.darkPng : flat.whitePng;
  if (leg != null && String(leg).trim() === u) {
    return legacyFlatTargetsSide(design, side) ? `assets.${key} (legacy flat → ${side})` : `assets.${key}`;
  }
  const fRoot = design.files || {};
  if (key === "lightPng" && fRoot.lightPng && fRoot.lightPng.downloadUrl && String(fRoot.lightPng.downloadUrl).trim() === u) {
    return "files.lightPng.downloadUrl";
  }
  if (key === "darkPng" && fRoot.darkPng && fRoot.darkPng.downloadUrl && String(fRoot.darkPng.downloadUrl).trim() === u) {
    return "files.darkPng.downloadUrl";
  }
  if (key === "whitePng" && fRoot.whitePng && fRoot.whitePng.downloadUrl && String(fRoot.whitePng.downloadUrl).trim() === u) {
    return "files.whitePng.downloadUrl";
  }
  return `resolved.${tone} (path unresolved)`;
}

module.exports = {
  pickDesignPngUrlForBlankPreview,
  describeDesignSidePngSourcePath,
  getEffectiveColorFamilyForBlankPreview: getEffectiveColorFamily,
};
