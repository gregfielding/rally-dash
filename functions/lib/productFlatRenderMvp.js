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
const { pickRasterUrlForVariant, resolveBackRenderTreatment } = require("./artworkToneResolution");
const {
  applyDesignWarp8394,
  applyDesignMask8394,
  cropDesignToArtworkBounds: cropDesignToArtworkBounds8394,
  snapshotWarp,
  snapshotMask,
} = require("./compositor8394");

const MASTER_BLANK_SCHEMA_VERSION = 2;
const MVP_STYLE_CODE = "8394";
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

function normalizeSimple8394(s) {
  if (!s || typeof s !== "object") return null;
  const realism = Math.max(0, Math.min(100, Math.round(Number(s.realism) || 52)));
  const inkStrength = Math.max(0, Math.min(100, Math.round(Number(s.inkStrength) || 95)));
  const presets = new Set(["small", "medium", "large", "fill_safe"]);
  const sizePreset = presets.has(s.sizePreset) ? s.sizePreset : "medium";
  return { realism, inkStrength, sizePreset };
}

function mapRealism8394(realism) {
  const r = Math.max(0, Math.min(100, realism));
  let blendMode;
  if (r < 28) blendMode = "normal";
  else if (r < 52) blendMode = "soft-light";
  else if (r < 76) blendMode = "overlay";
  else blendMode = "multiply";
  const t = r / 100;
  const blendOpacity = Math.max(0.74, Math.min(1, 1 - t * 0.16));
  return { blendMode, blendOpacity };
}

function mapInk8394(inkStrength) {
  const i = Math.max(0, Math.min(100, inkStrength)) / 100;
  const designOpacityMultiplier = Math.max(0.35, Math.min(1, 0.45 + 0.55 * i));
  const contrastPercent = Math.min(125, 88 + i * 32);
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
  } = options;

  const layoutPlacement =
    effPl && placementRow
      ? {
          ...placementRow,
          defaultX: tuning.settings.placement.x,
          defaultY: tuning.settings.placement.y,
          defaultScale: tuning.settings.placement.scale,
          safeArea: effPl.safeArea,
        }
      : placementRow;

  const blankMeta = await sharp(blankBuffer).metadata();
  const blankWidth = blankMeta.width;
  const blankHeight = blankMeta.height;
  if (!blankWidth || !blankHeight) {
    throw new functions.https.HttpsError("internal", "Invalid blank image dimensions");
  }

  const cropped = await cropDesignToArtworkBounds8394(designBuffer, sharp);
  const designBufferC = cropped.buffer;
  const designWidth = cropped.width;
  const designHeight = cropped.height;

  const { left: left0, top: top0, resizedWidth, resizedHeight } = computeLayout(
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

  const wm = await pipeWarpMaskForDesignLayer(resizedBasePng, sharp, tuning.settings);
  resizedBasePng = wm.buffer;

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
  } else {
    const mergedSimple = mergeSimple8394ForTarget(placementRow, variant, target);
    const d8394 = derive8394Engine(mergedSimple);
    let processedPng = resizedBasePng;
    if (d8394) {
      processedPng = await apply8394DesignTreatmentPng(processedPng, sharp, d8394);
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
  }

  return { flatCleanBuffer, flatBlendedBuffer, wm };
}

/**
 * Compute placement box + resized design dimensions (matches VisualPlacementEditor / onMockJobCreated).
 */
function computeLayout(blankWidth, blankHeight, placement, designWidth, designHeight) {
  const x = placement.defaultX ?? 0.5;
  const y = placement.defaultY ?? 0.5;
  const effectiveScale = placement.defaultScale ?? 0.6;
  const centerXpx = Math.round(x * blankWidth);
  const centerYpx = Math.round(y * blankHeight);
  const artBoxPxW = Math.round(blankWidth * ART_BASE * effectiveScale);
  const artBoxPxH = Math.round(blankHeight * ART_BASE * effectiveScale);
  const left0 = Math.round(centerXpx - artBoxPxW / 2);
  const top0 = Math.round(centerYpx - artBoxPxH / 2);
  const designAspect = designWidth / designHeight;
  const boxAspect = artBoxPxW / artBoxPxH;
  let resizedWidth;
  let resizedHeight;
  if (designAspect >= boxAspect) {
    resizedWidth = artBoxPxW;
    resizedHeight = Math.round(artBoxPxW / designAspect);
  } else {
    resizedHeight = artBoxPxH;
    resizedWidth = Math.round(artBoxPxH * designAspect);
  }
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

      if (String(blank.styleCode || "").trim() !== MVP_STYLE_CODE) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Step 10 MVP renderer only supports style ${MVP_STYLE_CODE} (this blank is ${blank.styleCode || "unknown"})`
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

      const variantFlatBackUrlBase =
        (variantDoc &&
          variantDoc.renderSetup &&
          variantDoc.renderSetup.back &&
          variantDoc.renderSetup.back.blankImageUrl) ||
        getVariantFlatBackUrl(blank, variant);
      const variantFlatFrontUrlBase =
        (variantDoc &&
          variantDoc.renderSetup &&
          variantDoc.renderSetup.front &&
          variantDoc.renderSetup.front.blankImageUrl) ||
        getVariantFlatFrontUrl(blank, variant);
      const variantModelBackUrlBase = getVariantModelBackUrl(blank, variant);
      const variantModelFrontUrlBase = getVariantModelFrontUrl(blank, variant);

      /* Priority-aligned default set: model_back (hero) → flat_front → flat_back → model_front */
      const autoExpandedTypes = [
        ...(variantModelBackUrlBase ? ["model_blended_back"] : []),
        ...(variantFlatFrontUrlBase ? ["flat_clean_front"] : []),
        ...(variantFlatBackUrlBase ? ["flat_blended_back"] : []),
        ...(variantModelFrontUrlBase ? ["model_clean_front"] : []),
      ];
      let renderTypes =
        rtRaw && rtRaw.length ? rtRaw.map((x) => String(x).trim()) : autoExpandedTypes.slice();
      const usedDefaultRenderTypes = !renderTypes.length;
      if (usedDefaultRenderTypes) {
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
        if (usedDefaultRenderTypes) {
          renderSelectionLog.push(
            "Note: auto list was empty — applied DEFAULT " + DEFAULT_RENDER_TYPES.join(", ")
          );
        }
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

        const { url: designPngUrl, ref: resolvedToneRef } = pickDesignPngForVariant(design, variant, variantDoc);
        if (!designPngUrl) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Design missing usable PNG for this garment (light/dark)"
          );
        }

        const colorNameForFam =
          (variantDoc && typeof variantDoc.colorName === "string" && variantDoc.colorName.trim()) ||
          variant.colorName;
        const pvFam = variantDoc && variantDoc.colorFamily;
        const garmentFam = getEffectiveColorFamily(
          pvFam === "light" || pvFam === "dark" ? pvFam : variant.colorFamily,
          colorNameForFam
        );
        const renderTreatment = resolveBackRenderTreatment(garmentFam, resolvedToneRef);

        let designBufferCached = null;

        if (wantBlendedBack) {
        const tuningFlat = resolveEffectiveRenderTargetSettings(placementProduct, blank, variant, "flat_back");
        const blend = resolveEngineBlendForRenderTarget(
          placementProduct,
          blank,
          variant,
          "flat_back",
          tuningFlat.settings.blend
        );
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
          })
        );

        const fingerprintPayload = {
          scope: "step10_mvp_8394_back_v6_flat_target",
          renderTarget: "flat_back",
          blankId,
          blankVariantId,
          blankVersion: getBlankVersionValue(blank),
          placementBack: placementFingerprintFlat,
          backBlend: blend,
          targetTuningQa: tuningFlat.qa,
          targetTuningPlacement: tuningFlat.settings.placement,
          targetTuningBlend01: tuningFlat.settings.blend,
          variantBackUrl: variantFlatBackUrl,
          designId,
          designVersion: getDesignVersionValue(design),
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
          blend,
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

        if (wantModelBlendedBack) {
          const tuningModel = resolveEffectiveRenderTargetSettings(placementProduct, blank, variant, "model_back");
          const blendM = resolveEngineBlendForRenderTarget(
            placementProduct,
            blank,
            variant,
            "model_back",
            tuningModel.settings.blend
          );
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
            })
          );
          const fingerprintPayloadM = {
            scope: "step10_mvp_8394_back_v6_model_target",
            renderTarget: "model_back",
            blankId,
            blankVariantId,
            blankVersion: getBlankVersionValue(blank),
            placementBack: placementFingerprintModel,
            backBlend: blendM,
            targetTuningQa: tuningModel.qa,
            targetTuningPlacement: tuningModel.settings.placement,
            targetTuningBlend01: tuningModel.settings.blend,
            variantBackUrl: variantModelBackUrl,
            designId,
            designVersion: getDesignVersionValue(design),
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
              blend: blendM,
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
          createdAt: now,
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
};
