"use strict";

/**
 * Mirrors lib/blanks/defaultPrintSides.ts + lib/products/resolvePrintSidesForProduct.ts
 * for Cloud Functions (create product, bulk mock) without TS compile.
 */

function garmentCategoryDefaultPrintSides(garmentCategory) {
  const c = String(garmentCategory || "").toLowerCase();
  if (c === "panty" || c === "thong") return "back_only";
  if (c === "tank" || c === "crewneck") return "front_only";
  return "both";
}

/** Keep aligned with lib/rp/blanks/styleRegistry.ts STYLE_REGISTRY.defaultPrintSides */
const STYLE_CODE_DEFAULT_PRINT_SIDES = {
  "8394": "back_only",
  "8390": "back_only",
  TR3008: "front_only",
  "1822GD": "front_only",
  HF07: "front_only",
};

function inferDefaultPrintSides(blank) {
  if (!blank) return "both";
  const d = blank.defaultPrintSides;
  if (d === "front_only" || d === "back_only" || d === "both") return d;
  const sc = String(blank.styleCode || "").trim();
  if (STYLE_CODE_DEFAULT_PRINT_SIDES[sc]) return STYLE_CODE_DEFAULT_PRINT_SIDES[sc];
  return garmentCategoryDefaultPrintSides(blank.garmentCategory);
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

function derivePrintSidesFromAssetPresence(design) {
  const hasF = sideHasNestedPng(design, "front");
  const hasB = sideHasNestedPng(design, "back");
  if (hasF && hasB) return "both";
  if (hasB && !hasF) return "back";
  if (hasF && !hasB) return "front";
  return null;
}

/** Aligns with lib/designs/designHelpers getDesignPrintSidesMode (server subset). */
function getDesignPrintSidesModeFromDoc(design) {
  if (!design) return "both";
  const ss = design.supportedSides;
  if (Array.isArray(ss) && ss.length > 0) {
    const norm = ss.map(s => String(s).trim().toLowerCase());
    const hasF = norm.includes("front");
    const hasB = norm.includes("back");
    if (hasF && hasB) return "both";
    if (hasB && !hasF) return "back";
    if (hasF && !hasB) return "front";
    return "both";
  }
  const fromAssets = derivePrintSidesFromAssetPresence(design);
  if (fromAssets) return fromAssets;
  const defs = design.placementDefaults || [];
  if (defs.length > 0) {
    const ids = defs.map(d => String(d.placementId || "").toLowerCase());
    const hasFront = ids.some(id => id.includes("front"));
    const hasBack = ids.some(id => id.includes("back"));
    if (hasFront && hasBack) return "both";
    if (hasBack && !hasFront) return "back";
    if (hasFront && !hasBack) return "front";
  }
  return "both";
}

function designPrintModeToArtworkMode(m) {
  if (m === "front") return "front_only";
  if (m === "back") return "back_only";
  return "both";
}

function modeToSides(m) {
  if (m === "front_only") return new Set(["front"]);
  if (m === "back_only") return new Set(["back"]);
  return new Set(["front", "back"]);
}

function resolvePrintSidesForProductBuild(blank, design) {
  const blankMode = inferDefaultPrintSides(blank);
  const designMode = designPrintModeToArtworkMode(getDesignPrintSidesModeFromDoc(design));
  const bs = modeToSides(blankMode);
  const ds = modeToSides(designMode);
  const intersection = new Set();
  for (const s of ds) {
    if (bs.has(s)) intersection.add(s);
  }
  let conflict = intersection.size === 0 ? "hard" : "none";
  let canGenerate = intersection.size > 0;
  let blockMessage;
  if (conflict === "hard") {
    blockMessage =
      `This blank defaults to ${blankMode === "front_only" ? "front-only" : blankMode === "back_only" ? "back-only" : "front and back"} print, ` +
      `but the design only has ${designMode === "front_only" ? "front-only" : designMode === "back_only" ? "back-only" : "front and back"} artwork. ` +
      "Adjust the blank, add artwork, or pick another design.";
  }
  let effectiveFront = intersection.has("front");
  let effectiveBack = intersection.has("back");
  const viewConstrained = applyBlankSupportedRenderViews(blank, {
    effectiveFront,
    effectiveBack,
    conflict,
    canGenerate,
    blockMessage,
  });
  effectiveFront = viewConstrained.effectiveFront;
  effectiveBack = viewConstrained.effectiveBack;
  conflict = viewConstrained.conflict;
  canGenerate = viewConstrained.canGenerate;
  blockMessage = viewConstrained.blockMessage != null ? viewConstrained.blockMessage : blockMessage;

  let primaryPlacementSide = "front";
  if (effectiveBack && !effectiveFront) primaryPlacementSide = "back";
  else if (effectiveFront && !effectiveBack) primaryPlacementSide = "front";
  else if (effectiveFront && effectiveBack) {
    const gv = blank.generationDefaults && blank.generationDefaults.primaryView;
    if (gv === "back") primaryPlacementSide = "back";
  }
  return {
    blankMode,
    designMode,
    conflict,
    canGenerate,
    effectiveFront,
    effectiveBack,
    primaryPlacementSide,
    blockMessage,
  };
}

function applyBlankSupportedRenderViews(blank, partial) {
  const raw = blank && blank.supportedRenderViews;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ...partial };
  }
  const allowed = new Set(raw.filter((x) => x === "front" || x === "back"));
  if (allowed.size === 0) {
    return { ...partial };
  }
  const effectiveFront = partial.effectiveFront && allowed.has("front");
  const effectiveBack = partial.effectiveBack && allowed.has("back");
  if (effectiveFront || effectiveBack) {
    return {
      effectiveFront,
      effectiveBack,
      conflict: partial.conflict,
      canGenerate: partial.canGenerate,
      blockMessage: partial.blockMessage,
    };
  }
  return {
    effectiveFront: false,
    effectiveBack: false,
    conflict: "hard",
    canGenerate: false,
    blockMessage:
      partial.blockMessage ||
      "This blank’s supportedRenderViews do not include any side that matches the current design × default print intersection.",
  };
}

module.exports = {
  inferDefaultPrintSides,
  garmentCategoryDefaultPrintSides,
  resolvePrintSidesForProductBuild,
  getDesignPrintSidesModeFromDoc,
};
