"use strict";

/**
 * Step 10 MVP: 8394 variant-native flats + optional model templates on `rp_products/.../variants/...`.
 * Callable `data`: productId, productVariantId (parent), optional renderTypes. When `renderTypes` is omitted,
 * expands from blank variant sources (flat + model URLs for back and front). **Back** targets get full design
 * compositing (placement, blend, warp, mask). **Front** targets are garment pass-through only (display photos).
 * Gallery seed order: model_back → flat_front → flat_back → model_front. heroBack prefers model blended back;
 * heroFront is flat garment front when present.
 */

const functions = require("firebase-functions");
const { DEFAULT_GARMENT_SAFE_AREA } = require("./designArtboardSpec");

/** Same rules as index.js sanitizeForFirestore — Firestore rejects undefined at any depth. */
function sanitizeForFirestore(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (value && typeof value.toDate === "function") return value;
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const sanitized = sanitizeForFirestore(v);
    if (sanitized !== undefined) out[k] = sanitized;
  }
  return out;
}
const {
  getPlacementRowForSide,
  getPlacementFingerprintSliceForRenderTarget,
  resolveEffectivePlacementForRenderTarget,
  resolveEffectiveRenderTargetSettings,
  resolveEngineBlendForRenderTarget,
  resolvePlacementKeyForRenderTarget,
  mergeSimple8394ForTarget,
} = require("./resolveProductRenderProfile");
const {
  getVariantFlatBackUrl,
  getVariantFlatFrontUrl,
  getVariantModelBackUrl,
  getVariantModelFrontUrl,
} = require("./variantRenderSources");
const {
  pickRasterUrlForVariant,
  resolveBackRenderTreatment,
  resolveBlendedPreviewBlend8394,
} = require("./artworkToneResolution");
const { resizeInsideDimensions8394 } = require("./resizeInside8394");
const {
  applyDesignWarp8394,
  applyDesignMask8394,
  cropDesignToArtworkBounds: cropDesignToArtworkBounds8394,
  snapshotWarp,
  snapshotMask,
} = require("./compositor8394");
const {
  resolve8394ProductImagePlan,
  enabledGenerationKeysInPlanOrder,
  expectsArtworkForPlanKey,
} = require("./blankProductImagePlan");
const { mergeRenderTargetSettings } = require("./renderTargetTuning");

const MASTER_BLANK_SCHEMA_VERSION = 2;
const MVP_STYLE_CODE = "8394";
const { isPipelineReadyStyleCode } = require("./pipelineReadiness");
const ART_BASE = 0.5;
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringify(x)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function fingerprintFromPayload(payload, crypto) {
  return crypto.createHash("sha256").update(stableStringify(payload), "utf8").digest("hex").slice(0, 40);
}

function deriveColorFamilyFromName(colorName) {
  const dark = new Set([
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
  const n = String(colorName || "")
    .trim()
    .toLowerCase();
  return dark.has(n) ? "dark" : "light";
}

function getEffectiveColorFamily(colorFamily, colorName) {
  if (colorFamily === "light" || colorFamily === "dark") return colorFamily;
  return deriveColorFamilyFromName(colorName);
}

function sideHasNestedPng(files, assets, side) {
  const a = assets && assets[side];
  const f = files && files[side];
  return !!(
    (a && (a.lightPng || a.darkPng || a.whitePng)) ||
    (f && f.lightPng && f.lightPng.downloadUrl) ||
    (f && f.darkPng && f.darkPng.downloadUrl) ||
    (f && f.whitePng && f.whitePng.downloadUrl)
  );
}

/** Matches client `hasAnySideAwareAssets` — any nested side has raster URLs. */
function hasAnySideAwarePngAssets(design) {
  const f = design.files || {};
  const a = design.assets || {};
  return sideHasNestedPng(f, a, "front") || sideHasNestedPng(f, a, "back");
}

/** Matches client `legacyFlatTargetsSide` for flat render (back placement). */
function legacyFlatTargetsSide(design, side) {
  const a = design.assets || {};
  const f = design.files || {};
  const legL = a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null;
  const legD = a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null;
  const hasLegacy = !!(legL || legD);
  if (!hasLegacy || hasAnySideAwarePngAssets(design)) return false;
  const ss = (design.supportedSides || []).map((s) => String(s).trim().toLowerCase());
  if (ss.length === 1) {
    if (ss[0] === "front") return side === "front";
    if (ss[0] === "back") return side === "back";
  }
  return side === "back";
}

/**
 * PNG URLs for **back** placement (8394 MVP). Matches `resolveDesignSideAssets(design, "back")`.
 */
function resolveBackSidePngUrls(design) {
  const a = design.assets || {};
  const f = design.files || {};
  const nsA = a.back || {};
  const nsF = f.back || {};
  let lightPng = nsA.lightPng || (nsF.lightPng && nsF.lightPng.downloadUrl) || null;
  let darkPng = nsA.darkPng || (nsF.darkPng && nsF.darkPng.downloadUrl) || null;
  let whitePng = nsA.whitePng || (nsF.whitePng && nsF.whitePng.downloadUrl) || null;
  const legL = a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null;
  const legD = a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null;
  const legW = a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null;
  if (legacyFlatTargetsSide(design, "back")) {
    lightPng = lightPng != null && lightPng !== "" ? lightPng : legL;
    darkPng = darkPng != null && darkPng !== "" ? darkPng : legD;
    whitePng = whitePng != null && whitePng !== "" ? whitePng : legW;
  }
  return { lightPng, darkPng, whitePng };
}

/**
 * PNG URLs for **front** placement (8394). Matches nested `design.assets.front` / legacy flat files.
 */
function resolveFrontSidePngUrls(design) {
  const a = design.assets || {};
  const f = design.files || {};
  const nsA = a.front || {};
  const nsF = f.front || {};
  let lightPng = nsA.lightPng || (nsF.lightPng && nsF.lightPng.downloadUrl) || null;
  let darkPng = nsA.darkPng || (nsF.darkPng && nsF.darkPng.downloadUrl) || null;
  let whitePng = nsA.whitePng || (nsF.whitePng && nsF.whitePng.downloadUrl) || null;
  const legL = a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null;
  const legD = a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null;
  const legW = a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null;
  if (legacyFlatTargetsSide(design, "front")) {
    lightPng = lightPng != null && lightPng !== "" ? lightPng : legL;
    darkPng = darkPng != null && darkPng !== "" ? darkPng : legD;
    whitePng = whitePng != null && whitePng !== "" ? whitePng : legW;
  }
  return { lightPng, darkPng, whitePng };
}

/**
 * @param {object} design
 * @param {object} blankVariantRow — `rp_blanks.variants[]` row
 * @param {object} [productVariantDoc] — `rp_products/.../variants/*`; merges colorName (and optional colorFamily / preferredArtworkTone when present)
 */
function pickDesignPngForVariant(design, blankVariantRow, productVariantDoc) {
  const colorName =
    (productVariantDoc &&
      typeof productVariantDoc.colorName === "string" &&
      productVariantDoc.colorName.trim()) ||
    blankVariantRow.colorName;
  const pvFam = productVariantDoc && productVariantDoc.colorFamily;
  const fam = getEffectiveColorFamily(
    pvFam === "light" || pvFam === "dark" ? pvFam : blankVariantRow.colorFamily,
    colorName
  );
  const pvPref = productVariantDoc && productVariantDoc.preferredArtworkTone;
  const pref =
    pvPref === "light" || pvPref === "dark" || pvPref === "white" ? pvPref : blankVariantRow.preferredArtworkTone;
  const u = resolveBackSidePngUrls(design);
  return pickRasterUrlForVariant(
    { lightPng: u.lightPng, darkPng: u.darkPng, whitePng: u.whitePng },
    fam,
    pref
  );
}

/**
 * Front-side design PNG for 8394 compositing (official flat_front_clean).
 */
function pickDesignPngForVariantFront(design, blankVariantRow, productVariantDoc) {
  const colorName =
    (productVariantDoc &&
      typeof productVariantDoc.colorName === "string" &&
      productVariantDoc.colorName.trim()) ||
    blankVariantRow.colorName;
  const pvFam = productVariantDoc && productVariantDoc.colorFamily;
  const fam = getEffectiveColorFamily(
    pvFam === "light" || pvFam === "dark" ? pvFam : blankVariantRow.colorFamily,
    colorName
  );
  const pvPref = productVariantDoc && productVariantDoc.preferredArtworkTone;
  const pref =
    pvPref === "light" || pvPref === "dark" || pvPref === "white" ? pvPref : blankVariantRow.preferredArtworkTone;
  const u = resolveFrontSidePngUrls(design);
  return pickRasterUrlForVariant(
    { lightPng: u.lightPng, darkPng: u.darkPng, whitePng: u.whitePng },
    fam,
    pref
  );
}

function normalizeSimple8394(s) {
  if (!s || typeof s !== "object") return null;
  const realism = Math.max(0, Math.min(100, Math.round(Number(s.realism) || 52)));
  const inkStrength = Math.max(0, Math.min(100, Math.round(Number(s.inkStrength) || 95)));
  const presets = new Set(["small", "medium", "large", "fill_safe"]);
  const sizePreset = presets.has(s.sizePreset) ? s.sizePreset : "medium";
  return { realism, inkStrength, sizePreset };
}

/** Matches `lib/blanks/preview8394` `mapRealismToBlendPreview`. */
function mapRealism8394(realism) {
  const r = Math.max(0, Math.min(100, realism));
  let blendMode;
  if (r < 22) blendMode = "normal";
  else if (r < 46) blendMode = "soft-light";
  else if (r < 70) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  const blendOpacity = Math.min(0.97, Math.max(0.4, 0.44 + (1 - t) * 0.52));
  return { blendMode, blendOpacity };
}

/** Matches `lib/blanks/preview8394` `mapInkStrengthToFactorsPreview` (contrast/sat only for Sharp). */
function mapInk8394(inkStrength) {
  const i = Math.max(0, Math.min(100, inkStrength)) / 100;
  const designOpacityMultiplier = Math.min(1, Math.max(0.12, 0.18 + 0.82 * i));
  const contrastPercent = Math.min(132, Math.max(58, 64 + i * 58));
  return { designOpacityMultiplier, contrastPercent };
}

function derive8394Engine(simple) {
  const n = normalizeSimple8394(simple);
  if (!n) return null;
  const { blendMode, blendOpacity } = mapRealism8394(n.realism);
  const { designOpacityMultiplier, contrastPercent } = mapInk8394(n.inkStrength);
  const scaleMap = { small: 0.38, medium: 0.58, large: 0.78, fill_safe: 0.98 };
  return {
    defaultScale: scaleMap[n.sizePreset] || 0.58,
    renderZoneDefaults: { blendMode, blendOpacity },
    designOpacityMultiplier,
    contrastPercent,
    realism: n.realism,
  };
}

/** Saturation + optional blur for “fabric integration” (8394 simple realism). */
async function apply8394DesignTreatmentPng(buffer, sharpLib, d8394) {
  if (!d8394) return buffer;
  let img = sharpLib(buffer).ensureAlpha();
  const sat = Math.min(1.12, (d8394.contrastPercent / 100) * 0.95 + 0.1);
  img = img.modulate({ saturation: sat });
  if (d8394.realism > 52) {
    img = img.blur(0.25 + (d8394.realism / 100) * 0.35);
  }
  return img.png().toBuffer();
}

/** Merge Firestore variant doc placement/render fields over parent for resolveEffectivePlacement. */
function mergePlacementSource(parent, variantDoc) {
  if (!variantDoc || typeof variantDoc !== "object") return parent;
  return {
    ...parent,
    renderSetup: variantDoc.renderSetup || parent.renderSetup,
    placementOverrides: variantDoc.placementOverrides != null ? variantDoc.placementOverrides : parent.placementOverrides,
    renderOverrides: variantDoc.renderOverrides != null ? variantDoc.renderOverrides : parent.renderOverrides,
  };
}

function getBlankVersionValue(blank) {
  if (blank.version != null && typeof blank.version === "number") return blank.version;
  const u = blank.updatedAt;
  if (u && typeof u.toMillis === "function") return u.toMillis();
  return null;
}

function getDesignVersionValue(design) {
  if (design.version != null && typeof design.version === "number") return design.version;
  const u = design.updatedAt;
  if (u && typeof u.toMillis === "function") return u.toMillis();
  return null;
}

function applyOpacityToRgbaBuffer(buffer, opacity) {
  const b = Buffer.from(buffer);
  for (let i = 3; i < b.length; i += 4) {
    b[i] = Math.round(b[i] * opacity);
  }
  return b;
}

function premultiplyRgbaBuffer(buffer) {
  const b = Buffer.from(buffer);
  for (let i = 0; i < b.length; i += 4) {
    const a = b[i + 3] / 255;
    b[i] = Math.round(b[i] * a);
    b[i + 1] = Math.round(b[i + 1] * a);
    b[i + 2] = Math.round(b[i + 2] * a);
  }
  return b;
}

function mapBlendMode(mode) {
  const m = String(mode || "multiply").toLowerCase();
  if (m === "normal") return "over";
  const allowed = new Set(["over", "multiply", "overlay", "soft-light", "screen", "darken", "lighten"]);
  if (allowed.has(m)) return m;
  return "multiply";
}

async function pipeWarpMaskForDesignLayer(buf, sharpLib, tuningSettings) {
  const warp = tuningSettings && tuningSettings.warp;
  const mask = tuningSettings && tuningSettings.mask;
  const warpApplied = !!(warp && warp.enabled === true);
  const maskApplied = !!(mask && mask.enabled === true);
  let out = buf;
  if (warpApplied) out = await applyDesignWarp8394(out, sharpLib, warp);
  if (maskApplied) out = await applyDesignMask8394(out, sharpLib, mask);
  return {
    buffer: out,
    warpApplied,
    maskApplied,
    resolvedWarp: snapshotWarp(warp),
    resolvedMask: snapshotMask(mask),
  };
}

const ARTWORK_BOUNDS_ALPHA_THRESHOLD_V = 5;

async function measureAlphaBoundsInRgbaPngBuffer(buf, sharp) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const stride = w * 4;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const a = data[row + x * 4 + 3];
      if (a > ARTWORK_BOUNDS_ALPHA_THRESHOLD_V) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    return { empty: true, minX: 0, minY: 0, maxX: w - 1, maxY: h - 1, w, h };
  }
  return {
    empty: false,
    minX,
    minY,
    maxX,
    maxY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function mergeSafeAreaNorm8394(layoutPlacement) {
  const base = { ...DEFAULT_GARMENT_SAFE_AREA };
  const s = layoutPlacement && layoutPlacement.safeArea;
  if (s && typeof s === "object") {
    if (s.x != null && Number.isFinite(Number(s.x))) base.x = Number(s.x);
    if (s.y != null && Number.isFinite(Number(s.y))) base.y = Number(s.y);
    if (s.w != null && Number.isFinite(Number(s.w))) base.w = Number(s.w);
    if (s.h != null && Number.isFinite(Number(s.h))) base.h = Number(s.h);
  }
  return base;
}

/** Same centering as clean/blended composite in this file (slot vs actual layer WxH). */
function compositeTopLeft8394(left0, top0, resizedWidth, resizedHeight, layerW, layerH, blankWidth, blankHeight) {
  const left = Math.max(0, Math.min(Math.round(left0 + (resizedWidth - layerW) / 2), blankWidth - layerW));
  const top = Math.max(0, Math.min(Math.round(top0 + (resizedHeight - layerH) / 2), blankHeight - layerH));
  return { x: left, y: top };
}

const DRIFT_CLASSIFY_EPSILON_PY = 0.5;

function classifyVerticalDrift8394(warpDyPy, treatmentDyPy, renderTreatment) {
  const w = Math.abs(warpDyPy) >= DRIFT_CLASSIFY_EPSILON_PY;
  const t = Math.abs(treatmentDyPy) >= DRIFT_CLASSIFY_EPSILON_PY;
  if (renderTreatment === "clean") {
    if (!w) return "neither";
    return "warp_only";
  }
  if (!w && !t) return "neither";
  if (w && !t) return "warp_only";
  if (!w && t) return "treatment_only";
  return "warp_and_treatment";
}

/**
 * Garment-space vertical metrics for one design-layer buffer (alpha scan + composite TL in slot).
 */
/** One row for [8394_VISIBLE_CENTER_MATRIX] (official pass: preview/delta columns null). */
function official8394VisibleCenterMatrixRowFromTelemetry(v) {
  if (!v) return null;
  const finalY = v.final && v.final.visibleCenterY != null ? v.final.visibleCenterY : v.visibleCenterY;
  return {
    "preview.visibleCenterY": null,
    "official.preWarp.visibleCenterY": v.preWarp ? v.preWarp.visibleCenterY : null,
    "official.postWarp.visibleCenterY": v.postWarp ? v.postWarp.visibleCenterY : null,
    "official.postTreatment.visibleCenterY": v.postTreatment != null ? v.postTreatment.visibleCenterY : null,
    "official.final.visibleCenterY": finalY,
    "official.visibleCenterY - preview.visibleCenterY": null,
    driftSourceVsPreWarp: v.driftSourceVsPreWarp != null ? v.driftSourceVsPreWarp : null,
  };
}

async function garmentVisibleMetricsSlice8394({
  sharp,
  stageLabel,
  blankWidth,
  blankHeight,
  left0,
  top0,
  resizedWidth,
  resizedHeight,
  buf,
  safeAreaNorm,
}) {
  const meta = await sharp(buf).metadata();
  const layerW = meta.width || 0;
  const layerH = meta.height || 0;
  const placed = compositeTopLeft8394(left0, top0, resizedWidth, resizedHeight, layerW, layerH, blankWidth, blankHeight);
  const alphaBounds = await measureAlphaBoundsInRgbaPngBuffer(buf, sharp);
  const bottomExclusive =
    alphaBounds.empty || alphaBounds.maxY < alphaBounds.minY
      ? placed.y + layerH
      : placed.y + alphaBounds.maxY + 1;
  const visibleHeightPx = alphaBounds.h;
  const visibleCenterY = bottomExclusive - visibleHeightPx / 2;
  const safeBottomY = (safeAreaNorm.y + safeAreaNorm.h) * blankHeight;
  return {
    stageLabel,
    bitmapPx: { w: layerW, h: layerH },
    compositeTopLeftPx: placed,
    alphaBoundsInPlacedBitmapPx: {
      minX: alphaBounds.minX,
      minY: alphaBounds.minY,
      maxX: alphaBounds.maxX,
      maxY: alphaBounds.maxY,
      w: alphaBounds.w,
      h: alphaBounds.h,
    },
    visibleBottomEdgeYExclusivePx: bottomExclusive,
    visibleHeightPx,
    visibleCenterY,
    garmentRasterHeightPx: blankHeight,
    distanceVisibleBottomToGarmentBottomPx: blankHeight - bottomExclusive,
    safeAreaNormMerged: safeAreaNorm,
    safeAreaBottomY_px: safeBottomY,
    distanceVisibleBottomToSafeAreaBottomPx: safeBottomY - bottomExclusive,
  };
}

/**
 * Shared 8394 compositor: crop design, layout, warp/mask, clean + blended PNG buffers on garment.
 */
async function render8394DesignOnGarmentSharp(options) {
  const {
    sharp,
    blankBuffer,
    designBuffer,
    tuning,
    blend,
    placementRow,
    effPl,
    variant,
    target,
    renderTreatment,
    renderSelectionLog,
    debugArtifacts,
  } = options;

  let artwork8394VisibleVerticalMetrics = null;

  const layoutPlacement =
    effPl && placementRow
      ? {
          ...placementRow,
          defaultX: tuning.settings.placement.x,
          defaultY: tuning.settings.placement.y,
          defaultScale: tuning.settings.placement.scale,
          safeArea: effPl.safeArea,
          artboardBase:
            effPl.artboardBase != null && Number.isFinite(Number(effPl.artboardBase))
              ? Number(effPl.artboardBase)
              : placementRow.artboardBase != null && Number.isFinite(Number(placementRow.artboardBase))
                ? Number(placementRow.artboardBase)
                : ART_BASE,
        }
      : placementRow;

  const blankMeta = await sharp(blankBuffer).metadata();
  const blankWidth = blankMeta.width;
  const blankHeight = blankMeta.height;
  if (!blankWidth || !blankHeight) {
    throw new functions.https.HttpsError("internal", "Invalid blank image dimensions");
  }

  const designMetaOriginal = await sharp(designBuffer).metadata();
  const designOriginalPx = {
    w: designMetaOriginal.width || null,
    h: designMetaOriginal.height || null,
  };

  const cropped = await cropDesignToArtworkBounds8394(designBuffer, sharp);
  const designBufferC = cropped.buffer;
  const designWidth = cropped.width;
  const designHeight = cropped.height;
  const alphaCropRectPx = {
    x: cropped.left != null ? cropped.left : 0,
    y: cropped.top != null ? cropped.top : 0,
    w: designWidth,
    h: designHeight,
  };

  const { left: left0, top: top0, resizedWidth, resizedHeight } = computeLayout8394(
    blankWidth,
    blankHeight,
    layoutPlacement,
    designWidth,
    designHeight
  );

  let resizedBasePng = await sharp(designBufferC)
    .resize(resizedWidth, resizedHeight, { fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const pngPreWarp = Buffer.from(resizedBasePng);

  const metaResizedBeforeWarp = await sharp(resizedBasePng).metadata();
  const resizedBitmapBeforeWarpPx = {
    w: metaResizedBeforeWarp.width || resizedWidth,
    h: metaResizedBeforeWarp.height || resizedHeight,
  };

  const wm = await pipeWarpMaskForDesignLayer(resizedBasePng, sharp, tuning.settings);
  resizedBasePng = wm.buffer;
  const pngPostWarp = Buffer.from(resizedBasePng);

  const metaAfterWarpMask = await sharp(resizedBasePng).metadata();
  const bitmapDimensionsAfterWarpMaskPx = {
    w: metaAfterWarpMask.width || resizedWidth,
    h: metaAfterWarpMask.height || resizedHeight,
  };

  const view = String(target).includes("back") ? "back" : "front";
  const slotHint =
    target === "flat_back"
      ? ["flat_clean.back", "flat_blended.back"]
      : target === "model_back"
        ? ["model_clean.back", "model_blended.back"]
        : [`composite.${target}`];
  renderSelectionLog.push(
    JSON.stringify({
      tag: "render_pass_qa",
      renderTarget: target,
      view,
      compositorPath: "design_composite_8394",
      usedDesignComposite: true,
      flatRenderSlotsHint: slotHint,
      lookTypesEmitted:
        renderTreatment === "clean"
          ? ["clean_primary", "blended_same_as_clean"]
          : ["clean_over", "blended_target_blend"],
      warpApplied: wm.warpApplied,
      resolvedWarp: wm.resolvedWarp,
      maskApplied: wm.maskApplied,
      resolvedMask: wm.resolvedMask,
      renderTreatment,
      outputShape:
        renderTreatment === "clean"
          ? { clean: true, blendedMatchesClean: true }
          : { clean: true, blended: true, blendMode: blend.blendMode, blendOpacity: blend.blendOpacity },
    })
  );

  let flatCleanBuffer;
  let flatBlendedBuffer;
  let mergedSimple8394 = null;
  let d8394Engine = null;
  /** Pixel placement audit (matches canvas: center anchor + fitted top-left; warp recenters in slot). */
  let placement8394PixelAudit = null;
  /** Blended path only: design bitmap WxH after apply8394DesignTreatmentPng (before clean opacity / blend stack). */
  let bitmapDimensionsAfterTreatmentPx = null;

  if (renderTreatment === "clean") {
    const cleanMeta = await sharp(resizedBasePng).metadata();
    const cw = cleanMeta.width || resizedWidth;
    const ch = cleanMeta.height || resizedHeight;
    const leftClean = Math.max(0, Math.min(Math.round(left0 + (resizedWidth - cw) / 2), blankWidth - cw));
    const topClean = Math.max(0, Math.min(Math.round(top0 + (resizedHeight - ch) / 2), blankHeight - ch));

    flatCleanBuffer = await sharp(blankBuffer)
      .composite([{ input: resizedBasePng, left: leftClean, top: topClean, blend: "over" }])
      .png()
      .toBuffer();
    flatBlendedBuffer = flatCleanBuffer;
    placement8394PixelAudit = {
      cleanCompositeTopLeftPx: { x: leftClean, y: topClean },
      blendedCompositeTopLeftPx: { x: leftClean, y: topClean },
      layerPxClean: { w: cw, h: ch },
      layerPxBlended: { w: cw, h: ch },
    };
    {
      const safeNorm = mergeSafeAreaNorm8394(layoutPlacement);
      const mPre = await garmentVisibleMetricsSlice8394({
        sharp,
        stageLabel: "preWarp_resizeInside_only",
        blankWidth: blankWidth,
        blankHeight: blankHeight,
        left0,
        top0,
        resizedWidth,
        resizedHeight,
        buf: pngPreWarp,
        safeAreaNorm: safeNorm,
      });
      const mPost = await garmentVisibleMetricsSlice8394({
        sharp,
        stageLabel: "postWarp_after_warp_mask",
        blankWidth: blankWidth,
        blankHeight: blankHeight,
        left0,
        top0,
        resizedWidth,
        resizedHeight,
        buf: pngPostWarp,
        safeAreaNorm: safeNorm,
      });
      const warpDy = mPost.visibleCenterY - mPre.visibleCenterY;
      const preWarp = { visibleCenterY: mPre.visibleCenterY };
      const postWarp = { visibleCenterY: mPost.visibleCenterY };
      const postTreatment = null;
      const final = { visibleCenterY: mPost.visibleCenterY };
      artwork8394VisibleVerticalMetrics = {
        kind: "official",
        renderTarget: target,
        renderTreatment: "clean",
        layerScannedForAlpha: "postWarp_resizedBasePng",
        preWarp,
        postWarp,
        postTreatment,
        final,
        placedBitmapTopLeftPx: mPost.compositeTopLeftPx,
        placedBitmapHeightPx: mPost.bitmapPx.h,
        alphaBoundsInPlacedBitmapPx: mPost.alphaBoundsInPlacedBitmapPx,
        visibleBottomEdgeYExclusivePx: mPost.visibleBottomEdgeYExclusivePx,
        visibleHeightPx: mPost.visibleHeightPx,
        visibleCenterY: final.visibleCenterY,
        garmentRasterHeightPx: mPost.garmentRasterHeightPx,
        distanceVisibleBottomToGarmentBottomPx: mPost.distanceVisibleBottomToGarmentBottomPx,
        safeAreaNormMerged: safeNorm,
        safeAreaBottomY_px: mPost.safeAreaBottomY_px,
        distanceVisibleBottomToSafeAreaBottomPx: mPost.distanceVisibleBottomToSafeAreaBottomPx,
        visibleCenterDeltaYVersusPreview: null,
        stagesGarmentSpace: { preWarp: mPre, postWarp: mPost },
        verticalDriftPy: { warp: warpDy, treatment: null },
        driftSourceVsPreWarp: classifyVerticalDrift8394(warpDy, 0, "clean"),
        pipelineDimensionHintsPx: {
          resizedBitmapBeforeWarpPx,
          bitmapDimensionsAfterWarpMaskPx,
          bitmapDimensionsAfterTreatmentPx: null,
        },
      };
    }
  } else {
    mergedSimple8394 = mergeSimple8394ForTarget(placementRow, variant, target);
    d8394Engine = derive8394Engine(mergedSimple8394);
    const d8394 = d8394Engine;
    let processedPng = resizedBasePng;
    if (d8394) {
      processedPng = await apply8394DesignTreatmentPng(processedPng, sharp, d8394);
      const mt = await sharp(processedPng).metadata();
      bitmapDimensionsAfterTreatmentPx = {
        w: mt.width || 0,
        h: mt.height || 0,
      };
    }

    let resizedCleanPng = processedPng;
    if (d8394) {
      const cleanRaw = await sharp(resizedCleanPng).raw().toBuffer({ depth: 8, resolveWithObject: true });
      const tw = applyOpacityToRgbaBuffer(cleanRaw.data, d8394.designOpacityMultiplier);
      resizedCleanPng = await sharp(tw, {
        raw: {
          width: cleanRaw.info.width,
          height: cleanRaw.info.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer();
    }

    const cleanMeta = await sharp(resizedCleanPng).metadata();
    const cw = cleanMeta.width || resizedWidth;
    const ch = cleanMeta.height || resizedHeight;
    const leftClean = Math.max(0, Math.min(Math.round(left0 + (resizedWidth - cw) / 2), blankWidth - cw));
    const topClean = Math.max(0, Math.min(Math.round(top0 + (resizedHeight - ch) / 2), blankHeight - ch));

    flatCleanBuffer = await sharp(blankBuffer)
      .composite([{ input: resizedCleanPng, left: leftClean, top: topClean, blend: "over" }])
      .png()
      .toBuffer();

    const resizedResult = await sharp(processedPng).raw().toBuffer({ depth: 8, resolveWithObject: true });
    let raw = resizedResult.data;
    const actualW = resizedResult.info.width;
    const actualH = resizedResult.info.height;
    const leftBlend = Math.max(0, Math.min(Math.round(left0 + (resizedWidth - actualW) / 2), blankWidth - actualW));
    const topBlend = Math.max(0, Math.min(Math.round(top0 + (resizedHeight - actualH) / 2), blankHeight - actualH));
    const inkMult = d8394 ? d8394.designOpacityMultiplier : 1;
    raw = applyOpacityToRgbaBuffer(raw, blend.blendOpacity * inkMult);
    raw = premultiplyRgbaBuffer(raw);
    const blendedInput = await sharp(raw, {
      raw: { width: actualW, height: actualH, channels: 4, premultiplied: true },
    })
      .png()
      .toBuffer();

    flatBlendedBuffer = await sharp(blankBuffer)
      .composite([
        {
          input: blendedInput,
          left: leftBlend,
          top: topBlend,
          blend: mapBlendMode(blend.blendMode),
          premultiplied: true,
        },
      ])
      .png()
      .toBuffer();
    placement8394PixelAudit = {
      cleanCompositeTopLeftPx: { x: leftClean, y: topClean },
      blendedCompositeTopLeftPx: { x: leftBlend, y: topBlend },
      layerPxClean: { w: cw, h: ch },
      layerPxBlended: { w: actualW, h: actualH },
    };
    {
      const safeNorm = mergeSafeAreaNorm8394(layoutPlacement);
      const mPre = await garmentVisibleMetricsSlice8394({
        sharp,
        stageLabel: "preWarp_resizeInside_only",
        blankWidth: blankWidth,
        blankHeight: blankHeight,
        left0,
        top0,
        resizedWidth,
        resizedHeight,
        buf: pngPreWarp,
        safeAreaNorm: safeNorm,
      });
      const mPostW = await garmentVisibleMetricsSlice8394({
        sharp,
        stageLabel: "postWarp_after_warp_mask",
        blankWidth: blankWidth,
        blankHeight: blankHeight,
        left0,
        top0,
        resizedWidth,
        resizedHeight,
        buf: pngPostWarp,
        safeAreaNorm: safeNorm,
      });
      const mPostT = await garmentVisibleMetricsSlice8394({
        sharp,
        stageLabel: "postTreatment_before_blend_premultiply",
        blankWidth: blankWidth,
        blankHeight: blankHeight,
        left0,
        top0,
        resizedWidth,
        resizedHeight,
        buf: processedPng,
        safeAreaNorm: safeNorm,
      });
      const warpDy = mPostW.visibleCenterY - mPre.visibleCenterY;
      const treatDy = mPostT.visibleCenterY - mPostW.visibleCenterY;
      const preWarp = { visibleCenterY: mPre.visibleCenterY };
      const postWarp = { visibleCenterY: mPostW.visibleCenterY };
      const postTreatment = { visibleCenterY: mPostT.visibleCenterY };
      const final = { visibleCenterY: mPostT.visibleCenterY };
      artwork8394VisibleVerticalMetrics = {
        kind: "official",
        renderTarget: target,
        renderTreatment,
        layerScannedForAlpha: "processedPng_after_treatment_before_blend_premultiply",
        preWarp,
        postWarp,
        postTreatment,
        final,
        placedBitmapTopLeftPx: mPostT.compositeTopLeftPx,
        placedBitmapHeightPx: mPostT.bitmapPx.h,
        alphaBoundsInPlacedBitmapPx: mPostT.alphaBoundsInPlacedBitmapPx,
        visibleBottomEdgeYExclusivePx: mPostT.visibleBottomEdgeYExclusivePx,
        visibleHeightPx: mPostT.visibleHeightPx,
        visibleCenterY: final.visibleCenterY,
        garmentRasterHeightPx: mPostT.garmentRasterHeightPx,
        distanceVisibleBottomToGarmentBottomPx: mPostT.distanceVisibleBottomToGarmentBottomPx,
        safeAreaNormMerged: safeNorm,
        safeAreaBottomY_px: mPostT.safeAreaBottomY_px,
        distanceVisibleBottomToSafeAreaBottomPx: mPostT.distanceVisibleBottomToSafeAreaBottomPx,
        visibleCenterDeltaYVersusPreview: null,
        stagesGarmentSpace: { preWarp: mPre, postWarp: mPostW, postTreatment: mPostT },
        verticalDriftPy: { warp: warpDy, treatment: treatDy },
        driftSourceVsPreWarp: classifyVerticalDrift8394(warpDy, treatDy, renderTreatment),
        pipelineDimensionHintsPx: {
          resizedBitmapBeforeWarpPx,
          bitmapDimensionsAfterWarpMaskPx,
          bitmapDimensionsAfterTreatmentPx,
        },
      };
    }
  }

  const garmentBlendModeMapped =
    renderTreatment === "clean" ? "over" : mapBlendMode(blend && blend.blendMode);
  const inkMultForBlend = d8394Engine ? d8394Engine.designOpacityMultiplier : 1;

  const postEffectBitmapDimensionsPx8394 = placement8394PixelAudit
    ? {
        clean: { w: placement8394PixelAudit.layerPxClean.w, h: placement8394PixelAudit.layerPxClean.h },
        blended: { w: placement8394PixelAudit.layerPxBlended.w, h: placement8394PixelAudit.layerPxBlended.h },
      }
    : null;

  const official8394StrictParity = {
    kind: "official",
    renderTarget: target,
    /** Same pass as dashboard preview mode: "clean" | "blended". */
    renderPipelineMode: renderTreatment,
    renderTreatment,
    garmentNaturalPx: { w: blankWidth, h: blankHeight },
    designNaturalPx: designOriginalPx,
    alphaCropRectPx,
    fittedSlotTopLeftPx: { x: left0, y: top0 },
    fittedSlotDimensionsPx: { w: resizedWidth, h: resizedHeight },
    resizedBitmapBeforeWarpPx,
    bitmapDimensionsAfterWarpMaskPx,
    bitmapDimensionsAfterTreatmentPx,
    postEffectBitmapDimensionsPx: postEffectBitmapDimensionsPx8394,
    finalCompositeTopLeftPx: placement8394PixelAudit
      ? {
          clean: placement8394PixelAudit.cleanCompositeTopLeftPx,
          blended: placement8394PixelAudit.blendedCompositeTopLeftPx,
        }
      : null,
    sharpBlendModeUsed: garmentBlendModeMapped,
    blendModeInput: blend && blend.blendMode,
    blendOpacityInput: blend && blend.blendOpacity,
    effectiveOpacityOnRaster:
      renderTreatment === "clean" ? null : blend && blend.blendOpacity * inkMultForBlend,
    treatmentEngine: d8394Engine
      ? {
          contrastPercent: d8394Engine.contrastPercent,
          realism: d8394Engine.realism,
          designOpacityMultiplier: d8394Engine.designOpacityMultiplier,
        }
      : null,
    warpApplied: wm.warpApplied,
    maskApplied: wm.maskApplied,
  };

  if (
    process.env.OFFICIAL8394_STRICT_PARITY === "1" ||
    process.env.OFFICIAL8394_STRICT_PARITY === "true"
  ) {
    console.log(`[OFFICIAL8394_STRICT_PARITY] ${JSON.stringify(official8394StrictParity)}`);
  }

  const abUsed =
    layoutPlacement &&
    layoutPlacement.artboardBase != null &&
    Number.isFinite(Number(layoutPlacement.artboardBase))
      ? Number(layoutPlacement.artboardBase)
      : ART_BASE;
  const plx = layoutPlacement?.defaultX ?? tuning?.settings?.placement?.x ?? 0.5;
  const ply = layoutPlacement?.defaultY ?? tuning?.settings?.placement?.y ?? 0.5;
  const centerPointPx = { x: Math.round(plx * blankWidth), y: Math.round(ply * blankHeight) };
  const placement8394LayoutDebug = {
    renderTarget: target,
    warpEnabledEffective: wm.warpApplied,
    maskEnabledEffective: wm.maskApplied,
    coordinateSpace: "normalized_0_1_defaultXY_on_full_blank_raster",
    anchorReference:
      "center_of_art_box_at_defaultXY_times_blank_size; CSS_equivalent_left_top_percent_plus_translate_-50pct",
    garmentBounds: "full_blank_image_pixels_safeArea_visual_only",
    scaleThenTranslateOrder: "max_fit_design_inside_artboardBase_times_scale_box_then_top_left_plus_clamp",
    artboardBaseUsed: abUsed,
    centerPointPx,
    blankPx: { w: blankWidth, h: blankHeight },
    preWarpSlotRectPx: { x: left0, y: top0, w: resizedWidth, h: resizedHeight },
    croppedDesignWxH: { w: designWidth, h: designHeight },
    postWarpBitmapDimensionsPx: postEffectBitmapDimensionsPx8394,
    finalCompositeTopLeftPx: placement8394PixelAudit
      ? {
          clean: placement8394PixelAudit.cleanCompositeTopLeftPx,
          blended: placement8394PixelAudit.blendedCompositeTopLeftPx,
        }
      : null,
    deltaBlendedVsPreWarpSlotTopLeftPx: placement8394PixelAudit
      ? {
          x: placement8394PixelAudit.blendedCompositeTopLeftPx.x - left0,
          y: placement8394PixelAudit.blendedCompositeTopLeftPx.y - top0,
        }
      : null,
    preWarpDesignSlotPx: {
      fittedTopLeft: { x: left0, y: top0 },
      fittedWxH: { w: resizedWidth, h: resizedHeight },
      croppedDesignWxH: { w: designWidth, h: designHeight },
    },
    postWarpCompositePx: placement8394PixelAudit,
  };
  const parityLine = {
    kind: "official",
    renderTarget: target,
    warpEnabledEffective: wm.warpApplied,
    artboardBaseUsed: abUsed,
    centerPointPx,
    preWarpSlotRectPx: { x: left0, y: top0, w: resizedWidth, h: resizedHeight },
    postWarpBitmapDimensionsPx: placement8394LayoutDebug.postWarpBitmapDimensionsPx,
    finalCompositeTopLeftBlendedPx: placement8394PixelAudit && placement8394PixelAudit.blendedCompositeTopLeftPx,
  };
  if (
    process.env.OFFICIAL_PLACEMENT_PARITY_LOG === "1" ||
    process.env.OFFICIAL_PLACEMENT_PARITY_LOG === "true"
  ) {
    console.log(`[PLACEMENT8394_PARITY] ${JSON.stringify(parityLine)}`);
  }
  if (
    process.env.OFFICIAL_PLACEMENT_DEBUG === "1" ||
    process.env.OFFICIAL_PLACEMENT_DEBUG === "true"
  ) {
    console.log("[render8394DesignOnGarmentSharp] PLACEMENT8394_DEBUG", JSON.stringify(placement8394LayoutDebug, null, 2));
  }

  const finalBlendedMeta = await sharp(flatBlendedBuffer).metadata();
  const finalCleanMeta = await sharp(flatCleanBuffer).metadata();
  const garmentWidth = blankWidth;
  const garmentHeight = blankHeight;
  const finalImageWidth = finalBlendedMeta.width ?? blankWidth;
  const finalImageHeight = finalBlendedMeta.height ?? blankHeight;
  const garment8394CoordinateSpaceAudit = {
    baseGarmentInputPx: { w: blankWidth, h: blankHeight },
    finalCompositeOutputPx: {
      blended: { w: finalBlendedMeta.width ?? null, h: finalBlendedMeta.height ?? null },
      clean: { w: finalCleanMeta.width ?? null, h: finalCleanMeta.height ?? null },
    },
    outputMatchesInputGarment:
      finalBlendedMeta.width === blankWidth &&
      finalBlendedMeta.height === blankHeight &&
      finalCleanMeta.width === blankWidth &&
      finalCleanMeta.height === blankHeight,
    postCompositeOnGarmentRaster: {
      trim: false,
      extract: false,
      resize: false,
      note:
        "Pipeline ends at sharp(blankBuffer).composite([...]).png().toBuffer() — no trim/extract/resize after composite.",
    },
    placementCoordinateSpace:
      "normalized defaultX/defaultY × full decoded blank raster (blankWidth × blankHeight) — same as baseGarmentInputPx",
    designSide: {
      originalFetchPx: designOriginalPx,
      afterArtworkAlphaCropPx: { w: designWidth, h: designHeight },
      artworkCropUsesSharpExtract: true,
      note: "cropDesignToArtworkBounds8394 applies extract() on the design PNG only; garment buffer is never cropped for placement.",
    },
  };

  const composeTelemetry = {
    renderTarget: target,
    renderTreatment,
    engineBlendInput: {
      blendMode: blend && blend.blendMode,
      blendOpacity: blend && blend.blendOpacity,
      fabricFeel: blend && blend.fabricFeel,
      printStrength: blend && blend.printStrength,
    },
    garmentComposite: {
      sharpBlendMode: garmentBlendModeMapped,
      blendOpacity: blend && blend.blendOpacity,
      inkMultiplierDesignOpacity: inkMultForBlend,
      effectiveOpacityOnGarmentPixels:
        renderTreatment === "clean" ? null : blend.blendOpacity * inkMultForBlend,
    },
    tuningPlacement: tuning && tuning.settings && tuning.settings.placement,
    tuningBlend01: tuning && tuning.settings && tuning.settings.blend,
    tuningWarp: tuning && tuning.settings && tuning.settings.warp,
    tuningMask: tuning && tuning.settings && tuning.settings.mask,
    warpOn: wm.warpApplied,
    maskOn: wm.maskApplied,
    resolvedWarp: wm.resolvedWarp,
    resolvedMask: wm.resolvedMask,
    simple8394Merged: mergedSimple8394,
    derived8394Engine: d8394Engine,
    treatmentPng:
      d8394Engine && renderTreatment !== "clean"
        ? {
            contrastPercent: d8394Engine.contrastPercent,
            realism: d8394Engine.realism,
            saturationModulate: Math.min(1.12, (d8394Engine.contrastPercent / 100) * 0.95 + 0.1),
            blurRadiusIfRealismGt52:
              d8394Engine.realism > 52 ? 0.25 + (d8394Engine.realism / 100) * 0.35 : 0,
            designOpacityMultiplier: d8394Engine.designOpacityMultiplier,
          }
        : null,
    placement8394LayoutDebug,
    garment8394CoordinateSpaceAudit,
    official8394StrictParity,
    artwork8394VisibleVerticalMetrics,
  };

  if (
    process.env.OFFICIAL8394_VISIBLE_CONTENT_V === "1" ||
    process.env.OFFICIAL8394_VISIBLE_CONTENT_V === "true"
  ) {
    console.log("[8394_VISIBLE_CONTENT_V]", JSON.stringify(artwork8394VisibleVerticalMetrics));
    console.log(
      "[8394_VISIBLE_CENTER_MATRIX]",
      JSON.stringify({
        source: "official",
        renderTarget: target,
        row: official8394VisibleCenterMatrixRowFromTelemetry(artwork8394VisibleVerticalMetrics),
      })
    );
  }

  if (
    process.env.OFFICIAL_GARMENT8394_COORD_AUDIT === "1" ||
    process.env.OFFICIAL_GARMENT8394_COORD_AUDIT === "true"
  ) {
    console.log(
      "[GARMENT8394_COORD_AUDIT]",
      JSON.stringify({ kind: "official", renderTarget: target, ...garment8394CoordinateSpaceAudit })
    );
  }

  let debugArtifactUrls = [];
  if (debugArtifacts && debugArtifacts.bucket && debugArtifacts.pathPrefix) {
    try {
      const prefix = String(debugArtifacts.pathPrefix).replace(/\/$/, "");
      const rawCopy = Buffer.from(designBuffer);
      const finalOut = renderTreatment === "clean" ? flatCleanBuffer : flatBlendedBuffer;
      const steps = [
        ["01_raw_design_fetched.png", rawCopy],
        ["02_overlay_after_warp_mask.png", resizedBasePng],
        ["03_final_composite.png", finalOut],
      ];
      for (const [name, buf] of steps) {
        if (!buf) continue;
        const storagePath = `${prefix}/${name}`;
        const url = await savePngAndReadableUrl(debugArtifacts.bucket, storagePath, buf);
        debugArtifactUrls.push({ name, storagePath, url });
      }
    } catch (err) {
      console.warn("[render8394DesignOnGarmentSharp] OFFICIAL_FLAT debug artifact save failed:", err && err.message);
    }
  }

  return { flatCleanBuffer, flatBlendedBuffer, wm, composeTelemetry, debugArtifactUrls };
}

/**
 * Compute placement box + resized design dimensions (matches VisualPlacementEditor / onMockJobCreated).
 * Uses `placement.artboardBase` when set (same as canvas `artBase`); else 0.5 (`ART_BASE`).
 */
function computeLayout8394(blankWidth, blankHeight, placement, designWidth, designHeight) {
  const x = placement.defaultX ?? 0.5;
  const y = placement.defaultY ?? 0.5;
  const effectiveScale = placement.defaultScale ?? 0.6;
  const ab =
    placement && placement.artboardBase != null && Number.isFinite(Number(placement.artboardBase))
      ? Number(placement.artboardBase)
      : ART_BASE;
  const centerXpx = Math.round(x * blankWidth);
  const centerYpx = Math.round(y * blankHeight);
  const artBoxPxW = Math.round(blankWidth * ab * effectiveScale);
  const artBoxPxH = Math.round(blankHeight * ab * effectiveScale);
  const left0 = Math.round(centerXpx - artBoxPxW / 2);
  const top0 = Math.round(centerYpx - artBoxPxH / 2);
  const fitted = resizeInsideDimensions8394(designWidth, designHeight, artBoxPxW, artBoxPxH);
  const resizedWidth = fitted.w;
  const resizedHeight = fitted.h;
  const left = Math.round(left0 + (artBoxPxW - resizedWidth) / 2);
  const top = Math.round(top0 + (artBoxPxH - resizedHeight) / 2);
  const leftClamped = Math.max(0, Math.min(left, blankWidth - resizedWidth));
  const topClamped = Math.max(0, Math.min(top, blankHeight - resizedHeight));
  return { left: leftClamped, top: topClamped, resizedWidth, resizedHeight };
}

/**
 * Save PNG and return a readable URL. Tries public ACL first; falls back to signed URL when
 * uniform bucket-level access blocks object ACLs (common on newer GCS buckets).
 */
async function savePngAndReadableUrl(bucket, storagePath, buf) {
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType: "image/png",
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  try {
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  } catch (aclErr) {
    console.warn(
      "[generateProductFlatRenders] makePublic failed (often uniform bucket access); using signed URL:",
      aclErr && aclErr.message
    );
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 366 * 24 * 60 * 60 * 1000, // ~1 year
    });
    return signedUrl;
  }
}

function dedupeGalleryUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (u == null || typeof u !== "string") continue;
    const s = u.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function executeProductFlatRender8394Mvp({ admin, db, storage, fetch, crypto, data, contextUid }) {
  try {
      const productId = data && data.productId;
      if (!productId || typeof productId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "productId is required");
      }

      const productVariantId =
        data && typeof data.productVariantId === "string" && data.productVariantId.trim()
          ? data.productVariantId.trim()
          : null;

      const sharp = require("sharp");
      const productRef = db.collection("rp_products").doc(productId);
      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Product not found");
      }
      const product = productSnap.data();

      const DEFAULT_RENDER_TYPES = [
        "model_blended_back",
        "flat_clean_front",
        "flat_blended_back",
        "model_clean_front",
      ];
      const rtRaw = data && Array.isArray(data.renderTypes) ? data.renderTypes : null;

      const isParent = product.productKind === "parent";
      if (isParent && !productVariantId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "productVariantId is required for parent (multi-variant) products"
        );
      }
      if (!isParent && productVariantId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "productVariantId is only valid for parent products"
        );
      }

      let variantDoc = null;
      let variantRef = null;
      if (isParent && productVariantId) {
        variantRef = productRef.collection("variants").doc(productVariantId);
        const variantSnap = await variantRef.get();
        if (!variantSnap.exists) {
          throw new functions.https.HttpsError("not-found", `Variant ${productVariantId} not found`);
        }
        variantDoc = variantSnap.data();
      }

      const targetRef = variantRef || productRef;
      const currentTarget = (await targetRef.get()).data() || {};

      const placementProduct = variantDoc ? mergePlacementSource(product, variantDoc) : product;

      const blankId = product.blankId;
      if (!blankId) {
        throw new functions.https.HttpsError("failed-precondition", "Product has no blankId");
      }

      const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
      if (!blankSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Blank not found");
      }
      const blank = blankSnap.data();

      /**
       * Gate by registry instead of MVP_STYLE_CODE so manual "Generate flats"
       * works on any pipelineReady blank (TR3008, HF07 once their renderers
       * are flipped on). The legacy MVP_STYLE_CODE constant stays for log
       * tags and historical identifiers.
       */
      if (!isPipelineReadyStyleCode(blank.styleCode)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Step 10 MVP renderer: blank styleCode "${blank.styleCode || "unknown"}" is not pipelineReady (see functions/lib/pipelineReadiness.js)`
        );
      }

      if (blank.schemaVersion !== MASTER_BLANK_SCHEMA_VERSION) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Step 10 MVP requires master blank (schemaVersion 2) with variants"
        );
      }

      const blankVariantId = variantDoc ? variantDoc.blankVariantId : product.blankVariantId;
      if (!blankVariantId) {
        throw new functions.https.HttpsError("failed-precondition", "blankVariantId is required for MVP render");
      }

      const variant = (blank.variants || []).find((v) => v.variantId === blankVariantId);
      if (!variant) {
        throw new functions.https.HttpsError("not-found", "Variant not found on blank");
      }
      if (variant.isActive === false) {
        throw new functions.https.HttpsError("failed-precondition", "Variant is inactive");
      }

      const imagePlan = resolve8394ProductImagePlan(blank, variant);

      const variantFlatBackUrlBase =
        imagePlan.flat_blended_back.resolvedSourcePhotoUrl ||
        (variantDoc &&
          variantDoc.renderSetup &&
          variantDoc.renderSetup.back &&
          variantDoc.renderSetup.back.blankImageUrl) ||
        getVariantFlatBackUrl(blank, variant);
      const variantFlatFrontUrlBase =
        imagePlan.flat_clean_front.resolvedSourcePhotoUrl ||
        (variantDoc &&
          variantDoc.renderSetup &&
          variantDoc.renderSetup.front &&
          variantDoc.renderSetup.front.blankImageUrl) ||
        getVariantFlatFrontUrl(blank, variant);
      const variantModelBackUrlBase =
        imagePlan.model_blended_back.resolvedSourcePhotoUrl || getVariantModelBackUrl(blank, variant);
      const variantModelFrontUrlBase =
        imagePlan.model_clean_front.resolvedSourcePhotoUrl || getVariantModelFrontUrl(blank, variant);

      const planOrderedEnabled = enabledGenerationKeysInPlanOrder(imagePlan);
      let renderTypes = rtRaw && rtRaw.length ? rtRaw.map((x) => String(x).trim()) : planOrderedEnabled.slice();
      if (!renderTypes.length) {
        renderTypes = DEFAULT_RENDER_TYPES.slice();
      }

      const sr = blank.supportedRenderViews;
      /**
       * supportedRenderViews gates *printed / composited* outputs per side, not display-only garment images.
       * - Back: flat_blended_back + model_blended_back composite design → respect "back" in supportedRenderViews.
       * - Front: flat_clean_front + model_clean_front are clean pass-through display images (no design layer);
       *   they are NOT blocked when front printing is disabled.
       * If we add front design compositing render types later, gate those with blankAllowsFront here.
       */
      const blankAllowsFront =
        !Array.isArray(sr) || sr.length === 0 || sr.includes("front");
      const blankAllowsBack =
        !Array.isArray(sr) || sr.length === 0 || sr.includes("back");
      const BACK_DESIGN_COMPOSITE_TYPES = new Set(["flat_blended_back", "model_blended_back"]);
      const renderTypesPreSidePolicy = renderTypes.slice();
      renderTypes = renderTypes.filter((t) => {
        if (BACK_DESIGN_COMPOSITE_TYPES.has(t) && !blankAllowsBack) return false;
        return true;
      });
      const sidePolicySkipLines = [];
      for (const t of renderTypesPreSidePolicy) {
        if (renderTypes.includes(t)) continue;
        if (BACK_DESIGN_COMPOSITE_TYPES.has(t) && !blankAllowsBack) {
          sidePolicySkipLines.push(`${t}: skipped — back_disabled`);
        }
      }

      const renderSelectionLog = [];
      if (rtRaw && rtRaw.length) {
        renderSelectionLog.push(
          "Explicit renderTypes from request: " + renderTypesPreSidePolicy.join(", ")
        );
      } else {
        renderSelectionLog.push("Auto-expanded (no renderTypes in request)");
        renderSelectionLog.push(
          variantFlatBackUrlBase
            ? "flat_blended_back: included — flat/back source URL present"
            : "flat_blended_back: skipped — no flat/back source URL"
        );
        renderSelectionLog.push(
          variantFlatFrontUrlBase
            ? "flat_clean_front: included — flat front source URL present"
            : "flat_clean_front: skipped — no flat front source URL"
        );
        renderSelectionLog.push(
          variantModelBackUrlBase
            ? "model_blended_back: included — modelBack URL present"
            : "model_blended_back: skipped — no modelBack URL"
        );
        renderSelectionLog.push(
          variantModelFrontUrlBase
            ? "model_clean_front: included — modelFront URL present"
            : "model_clean_front: skipped — no modelFront URL"
        );
        renderSelectionLog.push("Resolved renderTypes: " + renderTypesPreSidePolicy.join(", "));
        renderSelectionLog.push(
          "Blank shot plan (8394): enabled in gallery order = " + planOrderedEnabled.join(", ")
        );
      }
      for (const line of sidePolicySkipLines) {
        renderSelectionLog.push(line);
      }
      if (sidePolicySkipLines.length) {
        renderSelectionLog.push(
          "Blank print sides policy: supportedRenderViews=" +
            (Array.isArray(sr) && sr.length ? sr.join(", ") : "unset (both print sides allowed)")
        );
        renderSelectionLog.push(
          "Note: flat_clean_front and model_clean_front are display-only (no design composite); not gated by front print side."
        );
      }
      renderSelectionLog.push("Effective renderTypes: " + renderTypes.join(", "));
      console.info(
        JSON.stringify({
          tag: "flat8394_render_target_selection",
          productId,
          productVariantId,
          blankVariantId,
          lines: renderSelectionLog,
        })
      );

      const wantBlendedBack = renderTypes.includes("flat_blended_back");
      const wantModelBlendedBack = renderTypes.includes("model_blended_back");
      const wantFrontClean = renderTypes.includes("flat_clean_front");
      const wantModelFrontClean = renderTypes.includes("model_clean_front");
      const expectsArtworkFlatBack = wantBlendedBack ? expectsArtworkForPlanKey(imagePlan, "flat_blended_back") : false;
      const expectsArtworkModelBack = wantModelBlendedBack
        ? expectsArtworkForPlanKey(imagePlan, "model_blended_back")
        : false;
      const anyRequested =
        wantBlendedBack || wantModelBlendedBack || wantFrontClean || wantModelFrontClean;
      if (!anyRequested) {
        if (renderTypesPreSidePolicy.length && !renderTypes.length) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "All render types were skipped: blank supportedRenderViews may disable back design compositing (see renderSelectionLog: back_disabled)."
          );
        }
        throw new functions.https.HttpsError(
          "invalid-argument",
          "renderTypes must include at least one of: flat_blended_back, model_blended_back, flat_clean_front, model_clean_front"
        );
      }

      let placementRowFlat = null;
      let placementRowModel = null;
      let placementFingerprintFlat = null;
      let placementFingerprintModel = null;
      if (wantBlendedBack) {
        const pk = resolvePlacementKeyForRenderTarget(placementProduct, variant, "flat_back");
        placementRowFlat = getPlacementRowForSide(blank, "back", pk);
        if (!placementRowFlat) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Blank has no back placement; configure placements on the blank (e.g. back_center)"
          );
        }
        placementFingerprintFlat = getPlacementFingerprintSliceForRenderTarget(
          blank,
          placementProduct,
          "flat_back",
          variant
        );
      }
      if (wantModelBlendedBack) {
        const pkM = resolvePlacementKeyForRenderTarget(placementProduct, variant, "model_back");
        placementRowModel = getPlacementRowForSide(blank, "back", pkM);
        if (!placementRowModel) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Blank has no back placement; configure placements on the blank (e.g. back_center)"
          );
        }
        placementFingerprintModel = getPlacementFingerprintSliceForRenderTarget(
          blank,
          placementProduct,
          "model_back",
          variant
        );
      }

      const variantFlatBackUrl = wantBlendedBack ? variantFlatBackUrlBase : null;
      if (wantBlendedBack && !variantFlatBackUrl) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Variant has no flat back image URL (flatBack or legacy back)"
        );
      }

      const variantModelBackUrl = wantModelBlendedBack ? variantModelBackUrlBase : null;
      if (wantModelBlendedBack && !variantModelBackUrl) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Variant has no model back image URL (modelBack)"
        );
      }

      const variantFrontUrl = wantFrontClean ? variantFlatFrontUrlBase : null;
      if (wantFrontClean && (!variantFrontUrl || !String(variantFrontUrl).trim())) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "8394 flat render needs a front blank image per color (flatFront or legacy front)."
        );
      }

      const variantModelFrontUrl = wantModelFrontClean ? variantModelFrontUrlBase : null;
      if (wantModelFrontClean && (!variantModelFrontUrl || !String(variantModelFrontUrl).trim())) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "model_clean_front requires modelFront on the blank variant"
        );
      }

      const bucket = storage.bucket();
      const ts = Date.now();
      const basePath = productVariantId
        ? `rp_products/${productId}/variants/${productVariantId}/flat_renders/${ts}`
        : `rp_products/${productId}/flat_renders/${ts}`;

      async function uploadPng(suffix, buf) {
        const storagePath = `${basePath}_${suffix}.png`;
        const url = await savePngAndReadableUrl(bucket, storagePath, buf);
        return { storagePath, url };
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      /** Firestore rejects `FieldValue.serverTimestamp()` inside array elements; use Timestamp for `generatedRenderOutputs[]`. */
      const outputCreatedAt = admin.firestore.Timestamp.now();

      let sharedDesignDoc = null;
      let sharedDesignIdLoaded = null;

      let inputFingerprintFlat = null;
      let inputFingerprintModel = null;
      let clean = null;
      let blended = null;
      let flatCleanBackSlot = null;
      let flatBlendedBackSlot = null;
      let modelCleanBackSlot = null;
      let modelBlendedBackSlot = null;
      let modelClean = null;
      let modelBlended = null;

      if (wantBlendedBack || wantModelBlendedBack) {
        const needsBackDesignArt =
          (wantBlendedBack && expectsArtworkFlatBack) || (wantModelBlendedBack && expectsArtworkModelBack);

        const colorNameForFam =
          (variantDoc && typeof variantDoc.colorName === "string" && variantDoc.colorName.trim()) ||
          variant.colorName;
        const pvFam = variantDoc && variantDoc.colorFamily;
        const garmentFam = getEffectiveColorFamily(
          pvFam === "light" || pvFam === "dark" ? pvFam : variant.colorFamily,
          colorNameForFam
        );

        let designPngUrl = null;
        let resolvedToneRef = "garment_only";
        let renderTreatment = "clean";
        let designBufferCached = null;

        if (needsBackDesignArt) {
          const designId =
            (variantDoc && variantDoc.designIdBack && String(variantDoc.designIdBack).trim()) ||
            (product.designIdBack && String(product.designIdBack).trim()) ||
            (variantDoc && variantDoc.designId) ||
            product.designId;
          if (!designId) {
            throw new functions.https.HttpsError("failed-precondition", "Product has no designId (or designIdBack)");
          }

          const designSnap = await db.collection("designs").doc(designId).get();
          if (!designSnap.exists) {
            throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
          }
          const design = designSnap.data();
          sharedDesignDoc = design;
          sharedDesignIdLoaded = designId;

          const picked = pickDesignPngForVariant(design, variant, variantDoc);
          designPngUrl = picked.url;
          resolvedToneRef = picked.ref;
          if (!designPngUrl) {
            throw new functions.https.HttpsError(
              "failed-precondition",
              "Design missing usable PNG for this garment (light/dark)"
            );
          }
          renderTreatment = resolveBackRenderTreatment(garmentFam, resolvedToneRef);
        } else {
          renderSelectionLog.push(
            "Shot plan: back composite targets are garment-only (expectsArtwork=false) — design fetch skipped."
          );
        }

        if (wantBlendedBack) {
        if (!expectsArtworkFlatBack) {
          const blankRespG = await fetch(variantFlatBackUrl);
          if (!blankRespG.ok) {
            throw new functions.https.HttpsError("internal", `Failed to fetch blank back image: ${blankRespG.status}`);
          }
          const bufG = Buffer.from(await blankRespG.arrayBuffer());
          const primaryUp = await uploadPng("flat_back_garment_only", bufG);
          const dimsG = await sharp(bufG).metadata();
          const slotBackFlatG = (lookType, view, url, storagePath, fp, designRef, dims) => {
            const o = {
              url,
              storagePath,
              generatedAt: now,
              lookType,
              view,
              sourceBlankVariantId: blankVariantId,
              sourceDesignAssetRef: designRef,
              inputFingerprint: fp || inputFingerprintFlat,
            };
            if (dims && dims.width) o.width = dims.width;
            if (dims && dims.height) o.height = dims.height;
            return o;
          };
          const fpG = fingerprintFromPayload(
            {
              scope: "step10_mvp_8394_back_garment_only_flat",
              blankId,
              blankVariantId,
              variantBackUrl: variantFlatBackUrl,
            },
            crypto
          );
          inputFingerprintFlat = fpG;
          clean = primaryUp;
          blended = primaryUp;
          flatCleanBackSlot = slotBackFlatG(
            "flat_clean",
            "back",
            primaryUp.url,
            primaryUp.storagePath,
            fpG,
            "garment_only",
            dimsG
          );
          flatBlendedBackSlot = slotBackFlatG(
            "flat_blended",
            "back",
            primaryUp.url,
            primaryUp.storagePath,
            fpG,
            "garment_only",
            dimsG
          );
        } else {
        if (!designPngUrl) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "flat_blended_back expects artwork but no design PNG was resolved for this run"
          );
        }
        let tuningFlat = resolveEffectiveRenderTargetSettings(placementProduct, blank, variant, "flat_back");
        const shotPatchFlat = imagePlan.flat_blended_back && imagePlan.flat_blended_back.renderSettings;
        if (shotPatchFlat && typeof shotPatchFlat === "object") {
          tuningFlat = {
            ...tuningFlat,
            settings: mergeRenderTargetSettings(tuningFlat.settings, shotPatchFlat),
          };
        }
        const blend = resolveEngineBlendForRenderTarget(
          placementProduct,
          blank,
          variant,
          "flat_back",
          tuningFlat.settings.blend
        );
        let compositeBlend = blend;
        if (renderTreatment === "blended") {
          const adj = resolveBlendedPreviewBlend8394(garmentFam, resolvedToneRef, blend);
          compositeBlend = { blendMode: adj.blendMode, blendOpacity: adj.blendOpacity };
        }
        renderSelectionLog.push(
          JSON.stringify({
            tag: "render_target_tuning_resolved",
            renderTarget: "flat_back",
            placement: tuningFlat.settings.placement,
            blend: tuningFlat.settings.blend,
            warp: tuningFlat.settings.warp,
            mask: tuningFlat.settings.mask,
            blankTuningExisted: tuningFlat.qa.blankTuningExisted,
            variantTargetOverrideExisted: tuningFlat.qa.variantTargetOverrideExisted,
            productPlacementApplied: tuningFlat.qa.productPlacementApplied,
            engineBlend: blend,
            compositeBlend8394: renderTreatment === "blended" ? compositeBlend : blend,
          })
        );

        const fingerprintPayload = {
          scope: "step10_mvp_8394_back_v6_flat_target",
          renderTarget: "flat_back",
          blankId,
          blankVariantId,
          blankVersion: getBlankVersionValue(blank),
          placementBack: placementFingerprintFlat,
          backBlend: compositeBlend,
          targetTuningQa: tuningFlat.qa,
          targetTuningPlacement: tuningFlat.settings.placement,
          targetTuningBlend01: tuningFlat.settings.blend,
          variantBackUrl: variantFlatBackUrl,
          designId: sharedDesignIdLoaded,
          designVersion: sharedDesignDoc ? getDesignVersionValue(sharedDesignDoc) : null,
          garmentFamily: garmentFam,
          renderTreatment,
          resolvedTone: resolvedToneRef,
          designAssetRef: resolvedToneRef,
          designAssetUrl: designPngUrl,
        };
        inputFingerprintFlat = fingerprintFromPayload(fingerprintPayload, crypto);

        const blankResp = await fetch(variantFlatBackUrl);
        if (!blankResp.ok) {
          throw new functions.https.HttpsError("internal", `Failed to fetch blank back image: ${blankResp.status}`);
        }
        const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

        const designResp = await fetch(designPngUrl);
        if (!designResp.ok) {
          throw new functions.https.HttpsError("internal", `Failed to fetch design PNG: ${designResp.status}`);
        }
        const designBufferRaw = Buffer.from(await designResp.arrayBuffer());
        designBufferCached = designBufferRaw;

        const effPl = resolveEffectivePlacementForRenderTarget(placementProduct, blank, variant, "flat_back");

        const slotBackFlat = (lookType, view, url, storagePath, fp, designRef, dims) => {
          const o = {
            url,
            storagePath,
            generatedAt: now,
            lookType,
            view,
            sourceBlankVariantId: blankVariantId,
            sourceDesignAssetRef: designRef,
            inputFingerprint: fp || inputFingerprintFlat,
          };
          if (dims && dims.width) o.width = dims.width;
          if (dims && dims.height) o.height = dims.height;
          return o;
        };

        const { flatCleanBuffer, flatBlendedBuffer } = await render8394DesignOnGarmentSharp({
          sharp,
          blankBuffer,
          designBuffer: designBufferRaw,
          tuning: tuningFlat,
          blend: compositeBlend,
          placementRow: placementRowFlat,
          effPl,
          variant,
          target: "flat_back",
          renderTreatment,
          renderSelectionLog,
        });

        if (renderTreatment === "clean") {
          const primaryUp = await uploadPng("flat_back_primary_clean", flatCleanBuffer);
          clean = primaryUp;
          blended = primaryUp;
          const dims = await sharp(flatCleanBuffer).metadata();
          flatCleanBackSlot = slotBackFlat(
            "flat_clean",
            "back",
            primaryUp.url,
            primaryUp.storagePath,
            inputFingerprintFlat,
            resolvedToneRef,
            dims
          );
          flatBlendedBackSlot = slotBackFlat(
            "flat_blended",
            "back",
            primaryUp.url,
            primaryUp.storagePath,
            inputFingerprintFlat,
            resolvedToneRef,
            dims
          );
        } else {
          clean = await uploadPng("flat_clean_back", flatCleanBuffer);
          blended = await uploadPng("flat_blended_back", flatBlendedBuffer);

          const cleanDims = await sharp(flatCleanBuffer).metadata();
          const blendedDims = await sharp(flatBlendedBuffer).metadata();

          flatCleanBackSlot = slotBackFlat(
            "flat_clean",
            "back",
            clean.url,
            clean.storagePath,
            inputFingerprintFlat,
            resolvedToneRef,
            cleanDims
          );
          flatBlendedBackSlot = slotBackFlat(
            "flat_blended",
            "back",
            blended.url,
            blended.storagePath,
            inputFingerprintFlat,
            resolvedToneRef,
            blendedDims
          );
        }

        const debugFlat =
          process.env.DEBUG_FLAT_RENDER === "1" || process.env.FUNCTIONS_EMULATOR === "true";
        if (debugFlat) {
          const heroBackDbg =
            renderTreatment === "clean"
              ? clean && clean.url
                ? clean.url
                : null
              : blended && blended.url
                ? blended.url
                : null;
          console.info(
            JSON.stringify({
              tag: "flat8394_back",
              parentProductId: productId,
              variantId: productVariantId,
              colorName: colorNameForFam,
              garmentFamily: garmentFam,
              preferredArtworkTone:
                variantDoc && variantDoc.preferredArtworkTone != null
                  ? variantDoc.preferredArtworkTone
                  : variant.preferredArtworkTone,
              resolvedArtworkTone: resolvedToneRef,
              renderTreatment,
              selectedAssetRef: resolvedToneRef,
              writtenHeroBackUrl: heroBackDbg,
            })
          );
        }
        }
        }

        if (wantModelBlendedBack) {
          if (!expectsArtworkModelBack) {
            const blankRespMG = await fetch(variantModelBackUrl);
            if (!blankRespMG.ok) {
              throw new functions.https.HttpsError(
                "internal",
                `Failed to fetch model back blank image: ${blankRespMG.status}`
              );
            }
            const bufMG = Buffer.from(await blankRespMG.arrayBuffer());
            const primaryUpMG = await uploadPng("model_back_garment_only", bufMG);
            const dimsMG = await sharp(bufMG).metadata();
            const slotBackModelG = (lookType, view, url, storagePath, fp, designRef, dims) => {
              const o = {
                url,
                storagePath,
                generatedAt: now,
                lookType,
                view,
                sourceBlankVariantId: blankVariantId,
                sourceDesignAssetRef: designRef,
                inputFingerprint: fp || inputFingerprintModel,
              };
              if (dims && dims.width) o.width = dims.width;
              if (dims && dims.height) o.height = dims.height;
              return o;
            };
            const fpMG = fingerprintFromPayload(
              {
                scope: "step10_mvp_8394_back_garment_only_model",
                blankId,
                blankVariantId,
                variantBackUrl: variantModelBackUrl,
              },
              crypto
            );
            inputFingerprintModel = fpMG;
            modelClean = primaryUpMG;
            modelBlended = primaryUpMG;
            modelCleanBackSlot = slotBackModelG(
              "model_clean",
              "back",
              primaryUpMG.url,
              primaryUpMG.storagePath,
              fpMG,
              "garment_only",
              dimsMG
            );
            modelBlendedBackSlot = slotBackModelG(
              "model_blended",
              "back",
              primaryUpMG.url,
              primaryUpMG.storagePath,
              fpMG,
              "garment_only",
              dimsMG
            );
          } else {
            if (!designPngUrl) {
              throw new functions.https.HttpsError(
                "failed-precondition",
                "model_blended_back expects artwork but no design PNG was resolved for this run"
              );
            }
            let tuningModel = resolveEffectiveRenderTargetSettings(placementProduct, blank, variant, "model_back");
            const shotPatchModel = imagePlan.model_blended_back && imagePlan.model_blended_back.renderSettings;
            if (shotPatchModel && typeof shotPatchModel === "object") {
              tuningModel = {
                ...tuningModel,
                settings: mergeRenderTargetSettings(tuningModel.settings, shotPatchModel),
              };
            }
            const blendM = resolveEngineBlendForRenderTarget(
              placementProduct,
              blank,
              variant,
              "model_back",
              tuningModel.settings.blend
            );
            let compositeBlendM = blendM;
            if (renderTreatment === "blended") {
              const adjM = resolveBlendedPreviewBlend8394(garmentFam, resolvedToneRef, blendM);
              compositeBlendM = { blendMode: adjM.blendMode, blendOpacity: adjM.blendOpacity };
            }
            renderSelectionLog.push(
              JSON.stringify({
                tag: "render_target_tuning_resolved",
                renderTarget: "model_back",
                placement: tuningModel.settings.placement,
                blend: tuningModel.settings.blend,
                warp: tuningModel.settings.warp,
                mask: tuningModel.settings.mask,
                blankTuningExisted: tuningModel.qa.blankTuningExisted,
                variantTargetOverrideExisted: tuningModel.qa.variantTargetOverrideExisted,
                productPlacementApplied: tuningModel.qa.productPlacementApplied,
                engineBlend: blendM,
                compositeBlend8394: renderTreatment === "blended" ? compositeBlendM : blendM,
              })
            );
            const fingerprintPayloadM = {
              scope: "step10_mvp_8394_back_v6_model_target",
              renderTarget: "model_back",
              blankId,
              blankVariantId,
              blankVersion: getBlankVersionValue(blank),
              placementBack: placementFingerprintModel,
              backBlend: compositeBlendM,
              targetTuningQa: tuningModel.qa,
              targetTuningPlacement: tuningModel.settings.placement,
              targetTuningBlend01: tuningModel.settings.blend,
              variantBackUrl: variantModelBackUrl,
              designId: sharedDesignIdLoaded,
              designVersion: sharedDesignDoc ? getDesignVersionValue(sharedDesignDoc) : null,
              garmentFamily: garmentFam,
              renderTreatment,
              resolvedTone: resolvedToneRef,
              designAssetRef: resolvedToneRef,
              designAssetUrl: designPngUrl,
            };
            inputFingerprintModel = fingerprintFromPayload(fingerprintPayloadM, crypto);

            const blankRespM = await fetch(variantModelBackUrl);
            if (!blankRespM.ok) {
              throw new functions.https.HttpsError(
                "internal",
                `Failed to fetch model back blank image: ${blankRespM.status}`
              );
            }
            const blankBufferM = Buffer.from(await blankRespM.arrayBuffer());

            let designBufferForModel = designBufferCached;
            if (designBufferForModel == null) {
              const designRespM = await fetch(designPngUrl);
              if (!designRespM.ok) {
                throw new functions.https.HttpsError("internal", `Failed to fetch design PNG: ${designRespM.status}`);
              }
              designBufferForModel = Buffer.from(await designRespM.arrayBuffer());
            }

            const effPlM = resolveEffectivePlacementForRenderTarget(placementProduct, blank, variant, "model_back");

            const slotBackModel = (lookType, view, url, storagePath, fp, designRef, dims) => {
              const o = {
                url,
                storagePath,
                generatedAt: now,
                lookType,
                view,
                sourceBlankVariantId: blankVariantId,
                sourceDesignAssetRef: designRef,
                inputFingerprint: fp || inputFingerprintModel,
              };
              if (dims && dims.width) o.width = dims.width;
              if (dims && dims.height) o.height = dims.height;
              return o;
            };

            const { flatCleanBuffer: modelCleanBuf, flatBlendedBuffer: modelBlendedBuf } =
              await render8394DesignOnGarmentSharp({
                sharp,
                blankBuffer: blankBufferM,
                designBuffer: designBufferForModel,
                tuning: tuningModel,
                blend: compositeBlendM,
                placementRow: placementRowModel,
                effPl: effPlM,
                variant,
                target: "model_back",
                renderTreatment,
                renderSelectionLog,
              });

            if (renderTreatment === "clean") {
              const primaryUpM = await uploadPng("model_back_primary_clean", modelCleanBuf);
              modelClean = primaryUpM;
              modelBlended = primaryUpM;
              const dimsM = await sharp(modelCleanBuf).metadata();
              modelCleanBackSlot = slotBackModel(
                "model_clean",
                "back",
                primaryUpM.url,
                primaryUpM.storagePath,
                inputFingerprintModel,
                resolvedToneRef,
                dimsM
              );
              modelBlendedBackSlot = slotBackModel(
                "model_blended",
                "back",
                primaryUpM.url,
                primaryUpM.storagePath,
                inputFingerprintModel,
                resolvedToneRef,
                dimsM
              );
            } else {
              modelClean = await uploadPng("model_clean_back", modelCleanBuf);
              modelBlended = await uploadPng("model_blended_back", modelBlendedBuf);

              const cleanDimsM = await sharp(modelCleanBuf).metadata();
              const blendedDimsM = await sharp(modelBlendedBuf).metadata();

              modelCleanBackSlot = slotBackModel(
                "model_clean",
                "back",
                modelClean.url,
                modelClean.storagePath,
                inputFingerprintModel,
                resolvedToneRef,
                cleanDimsM
              );
              modelBlendedBackSlot = slotBackModel(
                "model_blended",
                "back",
                modelBlended.url,
                modelBlended.storagePath,
                inputFingerprintModel,
                resolvedToneRef,
                blendedDimsM
              );
            }
          }
        }
      }

      let flatCleanFrontSlot = null;
      let flatCleanFrontUrl = null;
      let frontFingerprint = null;

      if (wantFrontClean) {
        const frontResp = await fetch(variantFrontUrl);
        if (!frontResp.ok) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Failed to fetch front blank image: HTTP ${frontResp.status} (${String(variantFrontUrl).slice(0, 160)})`
          );
        }
        const frontBuf = Buffer.from(await frontResp.arrayBuffer());
        renderSelectionLog.push(
          JSON.stringify({
            tag: "render_pass_qa",
            renderTarget: "flat_front",
            view: "front",
            compositorPath: "garment_pass_through_display_only",
            usedDesignComposite: false,
            note: "8394 flat front: garment copy only (no design composite in this pipeline)",
          })
        );
        const frontFpPayload = {
          scope: "step10_mvp_8394_front_clean_v2_garment",
          blankId,
          blankVariantId,
          variantFrontUrl,
        };
        frontFingerprint = fingerprintFromPayload(frontFpPayload, crypto);
        const frontUp = await uploadPng("flat_clean_front", frontBuf);
        flatCleanFrontUrl = frontUp.url;
        const frontDims = await sharp(frontBuf).metadata();
        flatCleanFrontSlot = {
          url: frontUp.url,
          storagePath: frontUp.storagePath,
          generatedAt: now,
          lookType: "flat_clean",
          view: "front",
          sourceBlankVariantId: blankVariantId,
          inputFingerprint: frontFingerprint,
          ...(frontDims.width ? { width: frontDims.width } : {}),
          ...(frontDims.height ? { height: frontDims.height } : {}),
        };
      }

      let modelCleanFrontSlot = null;
      let modelCleanFrontUrl = null;
      let modelFrontFingerprint = null;

      if (wantModelFrontClean) {
        const mfResp = await fetch(variantModelFrontUrl);
        if (!mfResp.ok) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Failed to fetch model front blank image: HTTP ${mfResp.status}`
          );
        }
        const mfBuf = Buffer.from(await mfResp.arrayBuffer());
        renderSelectionLog.push(
          JSON.stringify({
            tag: "render_pass_qa",
            renderTarget: "model_front",
            view: "front",
            compositorPath: "garment_pass_through_display_only",
            usedDesignComposite: false,
            note: "8394 model front: garment copy only (no design composite in this pipeline)",
          })
        );
        const mfFpPayload = {
          scope: "step10_mvp_8394_model_front_clean_v1",
          blankId,
          blankVariantId,
          variantModelFrontUrl,
        };
        modelFrontFingerprint = fingerprintFromPayload(mfFpPayload, crypto);
        const mfUp = await uploadPng("model_clean_front", mfBuf);
        modelCleanFrontUrl = mfUp.url;
        const mfDims = await sharp(mfBuf).metadata();
        modelCleanFrontSlot = {
          url: mfUp.url,
          storagePath: mfUp.storagePath,
          generatedAt: now,
          lookType: "model_clean",
          view: "front",
          sourceBlankVariantId: blankVariantId,
          inputFingerprint: modelFrontFingerprint,
          ...(mfDims.width ? { width: mfDims.width } : {}),
          ...(mfDims.height ? { height: mfDims.height } : {}),
        };
      }

      const prevFlat = currentTarget.flatRenders || {};
      const mergedFlat = {
        flat_clean: {
          ...(prevFlat.flat_clean || {}),
          ...(flatCleanBackSlot && { back: flatCleanBackSlot }),
          ...(flatCleanFrontSlot && { front: flatCleanFrontSlot }),
        },
        flat_blended: {
          ...(prevFlat.flat_blended || {}),
          ...(flatBlendedBackSlot && { back: flatBlendedBackSlot }),
        },
        model_clean: {
          ...(prevFlat.model_clean || {}),
          ...(modelCleanBackSlot && { back: modelCleanBackSlot }),
          ...(modelCleanFrontSlot && { front: modelCleanFrontSlot }),
        },
        model_blended: {
          ...(prevFlat.model_blended || {}),
          ...(modelBlendedBackSlot && { back: modelBlendedBackSlot }),
        },
      };

      const mediaNext = { ...(currentTarget.media || {}) };
      const flatBlendedUrl = blended && blended.url ? blended.url : null;
      const modelBlendedUrl = modelBlended && modelBlended.url ? modelBlended.url : null;
      const heroBackUrl = modelBlendedUrl || flatBlendedUrl;
      if (heroBackUrl) {
        mediaNext.heroBack = heroBackUrl;
      }
      if (flatCleanFrontUrl) {
        mediaNext.heroFront = flatCleanFrontUrl;
      }
      /* Gallery: model_back (hero) → flat_front → flat_back → model_front */
      const gallerySeed = [];
      if (modelBlendedUrl) gallerySeed.push(modelBlendedUrl);
      if (flatCleanFrontUrl) gallerySeed.push(flatCleanFrontUrl);
      if (flatBlendedUrl) gallerySeed.push(flatBlendedUrl);
      if (modelCleanFrontUrl) gallerySeed.push(modelCleanFrontUrl);
      const existingGal = Array.isArray(mediaNext.gallery) ? mediaNext.gallery : [];
      mediaNext.gallery = dedupeGalleryUrls([...gallerySeed, ...existingGal]);

      const genOutputs = [];
      const pushGen = (role, sourceImageRole, slot, sort) => {
        if (!slot || !slot.url) return;
        genOutputs.push({
          role,
          sourceType: "variant_render_source",
          sourceImageRole,
          url: slot.url,
          storagePath: slot.storagePath != null ? slot.storagePath : null,
          width: slot.width != null ? slot.width : null,
          height: slot.height != null ? slot.height : null,
          sort,
          createdAt: outputCreatedAt,
          lookType: slot.lookType != null ? slot.lookType : null,
          view: slot.view != null ? slot.view : null,
        });
      };
      pushGen("model_back", "modelBack", modelBlendedBackSlot, 10);
      pushGen("flat_front", "flatFront", flatCleanFrontSlot, 20);
      pushGen("flat_back", "flatBack", flatBlendedBackSlot, 30);
      pushGen("model_front", "modelFront", modelCleanFrontSlot, 40);
      genOutputs.sort((a, b) => a.sort - b.sort);

      const prevGen = Array.isArray(currentTarget.generatedRenderOutputs)
        ? currentTarget.generatedRenderOutputs
        : [];
      const patchRoles = new Set(genOutputs.map((g) => g.role));
      const kept = prevGen.filter((g) => g && g.role && !patchRoles.has(g.role));
      const mergedGen = [...kept, ...genOutputs].sort((a, b) => (a.sort || 0) - (b.sort || 0));

      const uid =
        contextUid && typeof contextUid === "string" && contextUid.trim() ? contextUid.trim() : "system";

      const updatePayload = {
        flatRenders: mergedFlat,
        media: mediaNext,
        updatedAt: now,
        updatedBy: uid,
      };
      if (mergedGen.length) {
        updatePayload.generatedRenderOutputs = mergedGen;
      } else {
        updatePayload.generatedRenderOutputs = admin.firestore.FieldValue.delete();
      }
      if (heroBackUrl) {
        updatePayload.mockupUrl = heroBackUrl;
      }

      await targetRef.update(sanitizeForFirestore(updatePayload));

      /* Parent displayMedia rolls up from hero/default variant in onMockJobCreated when mock completes. */
      if (isParent && productVariantId) {
        await productRef.update(
          sanitizeForFirestore({
            flatRenders: admin.firestore.FieldValue.delete(),
            updatedAt: now,
            updatedBy: uid,
          })
        );
      }

      return {
        ok: true,
        productId,
        productVariantId: productVariantId || null,
        renderTypes,
        renderSelectionLog,
        inputFingerprint:
          inputFingerprintFlat ||
          inputFingerprintModel ||
          frontFingerprint ||
          modelFrontFingerprint ||
          null,
        urls: {
          flat_clean_back: clean ? clean.url : null,
          flat_blended_back: blended ? blended.url : null,
          flat_clean_front: flatCleanFrontUrl || null,
          flat_blended_front: null,
          model_clean_back: modelClean ? modelClean.url : null,
          model_blended_back: modelBlended ? modelBlended.url : null,
          model_clean_front: modelCleanFrontUrl || null,
          model_blended_front: null,
        },
      };
  } catch (err) {
    console.error("[generateProductFlatRenders] Unhandled error:", err && err.stack ? err.stack : err);
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    const msg = err && err.message ? String(err.message).slice(0, 480) : "Flat render failed";
    throw new functions.https.HttpsError("internal", msg);
  }
}

function createRegisterGenerateProductFlatRenders({ admin, db, storage, fetch, crypto }) {
  return functions
    .runWith({ memory: "1GB", timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
      try {
        if (!context.auth) {
          throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
        }
        return await executeProductFlatRender8394Mvp({
          admin,
          db,
          storage,
          fetch,
          crypto,
          data,
          contextUid: context.auth.uid,
        });
      } catch (err) {
        console.error("[generateProductFlatRenders] Unhandled error:", err && err.stack ? err.stack : err);
        if (err instanceof functions.https.HttpsError) {
          throw err;
        }
        const msg = err && err.message ? String(err.message).slice(0, 480) : "Flat render failed";
        throw new functions.https.HttpsError("internal", msg);
      }
    });
}

module.exports = {
  createRegisterGenerateProductFlatRenders,
  executeProductFlatRender8394Mvp,
  pickDesignPngForVariant,
  pickDesignPngForVariantFront,
  resolveFrontSidePngUrls,
  render8394DesignOnGarmentSharp,
  savePngAndReadableUrl,
  computeLayout8394,
};
