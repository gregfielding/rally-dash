"use strict";

/**
 * Step 10 MVP: 8394 variant-native flats on `rp_products/{id}/variants/{variantId}`.
 * Callable `data`: productId, productVariantId (required for parent), optional renderTypes
 * (default ["flat_blended_back","flat_clean_front"]). Assigns media.heroBack ← primary back URL (same as
 * flat_blended.back; clean treatment reuses that slot per Option A), heroFront ← flat_clean.front
 * (garment-only, no front artwork when back_only), mockupUrl ← primary back,
 * deduped gallery. Legacy single-product (non-parent) still writes the product doc when no variant id.
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
  getPlacementFingerprintSliceForProduct,
  resolveEffectivePlacement,
  resolveEffectiveRenderSettings,
  resolvePlacementKeyForSide,
} = require("./resolveProductRenderProfile");
const { pickRasterUrlForVariant, resolveBackRenderTreatment } = require("./artworkToneResolution");

const MASTER_BLANK_SCHEMA_VERSION = 2;
const MVP_STYLE_CODE = "8394";
const ART_BASE = 0.5;
const ARTWORK_BOUNDS_ALPHA_THRESHOLD = 5;

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
  const realism = Math.max(0, Math.min(100, Math.round(Number(s.realism) || 55)));
  const inkStrength = Math.max(0, Math.min(100, Math.round(Number(s.inkStrength) || 78)));
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
  const blendOpacity = Math.max(0.62, Math.min(1, 1 - t * 0.26));
  return { blendMode, blendOpacity };
}

function mapInk8394(inkStrength) {
  const i = Math.max(0, Math.min(100, inkStrength)) / 100;
  const designOpacityMultiplier = Math.max(0.2, Math.min(1, 0.38 + 0.62 * i));
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

function getVariantBackUrl(blank, variant) {
  return (
    (variant.images && variant.images.back && variant.images.back.downloadUrl) ||
    (blank.images && blank.images.back && blank.images.back.downloadUrl) ||
    null
  );
}

function getVariantFrontUrl(blank, variant) {
  return (
    (variant.images && variant.images.front && variant.images.front.downloadUrl) ||
    (blank.images && blank.images.front && blank.images.front.downloadUrl) ||
    null
  );
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

async function cropDesignToArtworkBounds(designBuffer, sharp) {
  const meta = await sharp(designBuffer).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) return { buffer: designBuffer, width: w || 1, height: h || 1 };

  const raw = await sharp(designBuffer).ensureAlpha().raw().toBuffer({ depth: 8, resolveWithObject: false });

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = raw[i + 3];
      if (a > ARTWORK_BOUNDS_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boundsW = maxX >= minX ? maxX - minX + 1 : w;
  const boundsH = maxY >= minY ? maxY - minY + 1 : h;
  if (boundsW < 1 || boundsH < 1) {
    return { buffer: designBuffer, width: w, height: h };
  }

  const cropped = await sharp(designBuffer)
    .extract({ left: minX, top: minY, width: boundsW, height: boundsH })
    .png()
    .toBuffer();

  return { buffer: cropped, width: boundsW, height: boundsH };
}

function mapBlendMode(mode) {
  const m = String(mode || "multiply").toLowerCase();
  if (m === "normal") return "over";
  const allowed = new Set(["over", "multiply", "overlay", "soft-light", "screen", "darken", "lighten"]);
  if (allowed.has(m)) return m;
  return "multiply";
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

      const DEFAULT_RENDER_TYPES = ["flat_blended_back", "flat_clean_front"];
      const rtRaw = data && Array.isArray(data.renderTypes) ? data.renderTypes : null;
      const renderTypes =
        rtRaw && rtRaw.length ? rtRaw.map((x) => String(x).trim()) : DEFAULT_RENDER_TYPES;
      const wantBlendedBack = renderTypes.includes("flat_blended_back");
      const wantFrontClean = renderTypes.includes("flat_clean_front");
      if (!wantBlendedBack && !wantFrontClean) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "renderTypes must include at least one of: flat_blended_back, flat_clean_front"
        );
      }

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

      let placementRow = null;
      let placementFingerprint = null;
      if (wantBlendedBack) {
        const pk = resolvePlacementKeyForSide(placementProduct, variant, "back");
        placementRow = getPlacementRowForSide(blank, "back", pk);
        if (!placementRow) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Blank has no back placement; configure placements on the blank (e.g. back_center)"
          );
        }
        placementFingerprint = getPlacementFingerprintSliceForProduct(blank, placementProduct, "back", variant);
      }

      const variantBackUrl = wantBlendedBack
        ? (variantDoc &&
            variantDoc.renderSetup &&
            variantDoc.renderSetup.back &&
            variantDoc.renderSetup.back.blankImageUrl) ||
          getVariantBackUrl(blank, variant)
        : null;
      if (wantBlendedBack && !variantBackUrl) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Variant has no back image URL; upload back image on the variant"
        );
      }

      const variantFrontUrl = wantFrontClean
        ? (variantDoc &&
            variantDoc.renderSetup &&
            variantDoc.renderSetup.front &&
            variantDoc.renderSetup.front.blankImageUrl) ||
          getVariantFrontUrl(blank, variant)
        : null;
      if (wantFrontClean && (!variantFrontUrl || !String(variantFrontUrl).trim())) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "8394 flat render needs a front blank image per color (renderSetup.front.blankImageUrl or blank variant images.front)."
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

      let inputFingerprint = null;
      let clean = null;
      let blended = null;
      let flatCleanBackSlot = null;
      let flatBlendedBackSlot = null;

      if (wantBlendedBack) {
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

        const blend = resolveEffectiveRenderSettings(placementProduct, blank, variant, placementRow, "back");

        const fingerprintPayload = {
          scope: "step10_mvp_8394_back_v5_tone_treatment",
          blankId,
          blankVariantId,
          blankVersion: getBlankVersionValue(blank),
          placementBack: placementFingerprint,
          backBlend: blend,
          variantBackUrl,
          designId,
          designVersion: getDesignVersionValue(design),
          garmentFamily: garmentFam,
          renderTreatment,
          resolvedTone: resolvedToneRef,
          designAssetRef: resolvedToneRef,
          designAssetUrl: designPngUrl,
        };
        inputFingerprint = fingerprintFromPayload(fingerprintPayload, crypto);

        const blankResp = await fetch(variantBackUrl);
        if (!blankResp.ok) {
          throw new functions.https.HttpsError("internal", `Failed to fetch blank back image: ${blankResp.status}`);
        }
        const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

        const designResp = await fetch(designPngUrl);
        if (!designResp.ok) {
          throw new functions.https.HttpsError("internal", `Failed to fetch design PNG: ${designResp.status}`);
        }
        let designBuffer = Buffer.from(await designResp.arrayBuffer());

        const cropped = await cropDesignToArtworkBounds(designBuffer, sharp);
        designBuffer = cropped.buffer;
        const designWidth = cropped.width;
        const designHeight = cropped.height;

        const blankMeta = await sharp(blankBuffer).metadata();
        const blankWidth = blankMeta.width;
        const blankHeight = blankMeta.height;
        if (!blankWidth || !blankHeight) {
          throw new functions.https.HttpsError("internal", "Invalid blank image dimensions");
        }

        const effPl = resolveEffectivePlacement(placementProduct, blank, "back", variant);
        const layoutPlacement =
          effPl && placementRow
            ? {
                ...placementRow,
                defaultX: effPl.defaultX,
                defaultY: effPl.defaultY,
                defaultScale: effPl.defaultScale,
              }
            : placementRow;
        const { left: left0, top: top0, resizedWidth, resizedHeight } = computeLayout(
          blankWidth,
          blankHeight,
          layoutPlacement,
          designWidth,
          designHeight
        );

        const resizedBasePng = await sharp(designBuffer)
          .resize(resizedWidth, resizedHeight, { fit: "inside" })
          .ensureAlpha()
          .png()
          .toBuffer();

        const slotBack = (lookType, view, url, storagePath, fp, designRef, dims) => {
          const o = {
            url,
            storagePath,
            generatedAt: now,
            lookType,
            view,
            sourceBlankVariantId: blankVariantId,
            sourceDesignAssetRef: designRef,
            inputFingerprint: fp || inputFingerprint,
          };
          if (dims && dims.width) o.width = dims.width;
          if (dims && dims.height) o.height = dims.height;
          return o;
        };

        if (renderTreatment === "clean") {
          const cleanMeta = await sharp(resizedBasePng).metadata();
          const cw = cleanMeta.width || resizedWidth;
          const ch = cleanMeta.height || resizedHeight;
          const leftClean = Math.max(0, Math.min(Math.round(left0 + (resizedWidth - cw) / 2), blankWidth - cw));
          const topClean = Math.max(0, Math.min(Math.round(top0 + (resizedHeight - ch) / 2), blankHeight - ch));

          const flatPrimaryBuffer = await sharp(blankBuffer)
            .composite([{ input: resizedBasePng, left: leftClean, top: topClean, blend: "over" }])
            .png()
            .toBuffer();

          const primaryUp = await uploadPng("flat_back_primary_clean", flatPrimaryBuffer);
          clean = primaryUp;
          blended = primaryUp;
          const dims = await sharp(flatPrimaryBuffer).metadata();
          flatCleanBackSlot = slotBack(
            "flat_clean",
            "back",
            primaryUp.url,
            primaryUp.storagePath,
            inputFingerprint,
            resolvedToneRef,
            dims
          );
          flatBlendedBackSlot = slotBack(
            "flat_blended",
            "back",
            primaryUp.url,
            primaryUp.storagePath,
            inputFingerprint,
            resolvedToneRef,
            dims
          );
        } else {
          const d8394 = derive8394Engine(placementRow.simpleRenderControls8394);
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

          const flatCleanBuffer = await sharp(blankBuffer)
            .composite([{ input: resizedCleanPng, left: leftClean, top: topClean, blend: "over" }])
            .png()
            .toBuffer();

          const resizedResult = await sharp(processedPng).raw().toBuffer({ depth: 8, resolveWithObject: true });
          let raw = resizedResult.data;
          const actualW = resizedResult.info.width;
          const actualH = resizedResult.info.height;
          const leftBlend = Math.max(
            0,
            Math.min(Math.round(left0 + (resizedWidth - actualW) / 2), blankWidth - actualW)
          );
          const topBlend = Math.max(
            0,
            Math.min(Math.round(top0 + (resizedHeight - actualH) / 2), blankHeight - actualH)
          );
          const inkMult = d8394 ? d8394.designOpacityMultiplier : 1;
          raw = applyOpacityToRgbaBuffer(raw, blend.blendOpacity * inkMult);
          raw = premultiplyRgbaBuffer(raw);
          const blendedInput = await sharp(raw, {
            raw: { width: actualW, height: actualH, channels: 4, premultiplied: true },
          })
            .png()
            .toBuffer();

          const flatBlendedBuffer = await sharp(blankBuffer)
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

          clean = await uploadPng("flat_clean_back", flatCleanBuffer);
          blended = await uploadPng("flat_blended_back", flatBlendedBuffer);

          const cleanDims = await sharp(flatCleanBuffer).metadata();
          const blendedDims = await sharp(flatBlendedBuffer).metadata();

          flatCleanBackSlot = slotBack(
            "flat_clean",
            "back",
            clean.url,
            clean.storagePath,
            inputFingerprint,
            resolvedToneRef,
            cleanDims
          );
          flatBlendedBackSlot = slotBack(
            "flat_blended",
            "back",
            blended.url,
            blended.storagePath,
            inputFingerprint,
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
      };

      const mediaNext = { ...(currentTarget.media || {}) };
      const blendedUrl = blended && blended.url ? blended.url : null;
      if (blendedUrl) {
        mediaNext.heroBack = blendedUrl;
      }
      if (flatCleanFrontUrl) {
        mediaNext.heroFront = flatCleanFrontUrl;
      }
      const gallerySeed = [];
      if (blendedUrl) gallerySeed.push(blendedUrl);
      if (flatCleanFrontUrl) gallerySeed.push(flatCleanFrontUrl);
      const existingGal = Array.isArray(mediaNext.gallery) ? mediaNext.gallery : [];
      mediaNext.gallery = dedupeGalleryUrls([...gallerySeed, ...existingGal]);

      const uid =
        contextUid && typeof contextUid === "string" && contextUid.trim() ? contextUid.trim() : "system";

      const updatePayload = {
        flatRenders: mergedFlat,
        media: mediaNext,
        updatedAt: now,
        updatedBy: uid,
      };
      if (blendedUrl) {
        updatePayload.mockupUrl = blendedUrl;
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
        inputFingerprint: inputFingerprint || frontFingerprint,
        urls: {
          flat_clean_back: clean ? clean.url : null,
          flat_blended_back: blended ? blended.url : null,
          flat_clean_front: flatCleanFrontUrl || null,
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
