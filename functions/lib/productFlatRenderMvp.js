"use strict";

/**
 * Step 10 MVP: deterministic flat_clean + flat_blended for LA Apparel 8394 Bikini Panty, back view only.
 * Inputs: master blank placements (back), variant back image, design light/dark PNG by variant colorFamily,
 * blank + variant render defaults (back). See lib/products/flatRenderFingerprint.ts (must match fingerprint JSON).
 */

const functions = require("firebase-functions");
const { DEFAULT_GARMENT_SAFE_AREA } = require("./designArtboardSpec");
const {
  getPlacementRowForSide,
  getPlacementFingerprintSliceForProduct,
  resolveEffectivePlacement,
  resolveEffectiveRenderSettings,
} = require("./resolveProductRenderProfile");

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
  const dark = new Set(["Black", "Midnight Navy", "Navy", "Indigo"]);
  const n = String(colorName || "").trim();
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
    (a && (a.lightPng || a.darkPng)) ||
    (f && f.lightPng && f.lightPng.downloadUrl) ||
    (f && f.darkPng && f.darkPng.downloadUrl)
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
  const legL = a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null;
  const legD = a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null;
  if (legacyFlatTargetsSide(design, "back")) {
    lightPng = lightPng != null && lightPng !== "" ? lightPng : legL;
    darkPng = darkPng != null && darkPng !== "" ? darkPng : legD;
  }
  return { lightPng, darkPng };
}

function pickDesignPngForVariant(design, variant) {
  const fam = getEffectiveColorFamily(variant.colorFamily, variant.colorName);
  const u = resolveBackSidePngUrls(design);
  if (fam === "dark") {
    const url = u.darkPng || u.lightPng;
    return { url, ref: u.darkPng ? "dark" : "light" };
  }
  const url = u.lightPng || u.darkPng;
  return { url, ref: u.lightPng ? "light" : "dark" };
}

function getBackPlacementRow(blank) {
  const list = blank.placements || [];
  const backs = list.filter((p) => String(p.placementId).startsWith("back_"));
  if (backs.length === 0) return null;
  return backs.find((p) => p.placementId === "back_center") || backs[0];
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

function getBackPlacementFingerprintSlice(row) {
  if (!row) return null;
  const simple = row.simpleRenderControls8394 != null ? normalizeSimple8394(row.simpleRenderControls8394) : null;
  return {
    placementId: row.placementId,
    defaultX: row.defaultX ?? 0.5,
    defaultY: row.defaultY ?? 0.5,
    defaultScale: row.defaultScale ?? 0.6,
    safeArea: row.safeArea || { ...DEFAULT_GARMENT_SAFE_AREA },
    artboardBase:
      row.artboardBase != null && Number.isFinite(Number(row.artboardBase))
        ? Number(row.artboardBase)
        : 0.5,
    renderZoneDefaults: row.renderZoneDefaults || null,
    simpleRenderControls8394: simple,
  };
}

function getBackBlend(blank, variant, placementRow) {
  const rd = blank.renderDefaults || {};
  const vo = variant.renderOverrides || {};
  let zd = (placementRow && placementRow.renderZoneDefaults) || {};
  if (placementRow && placementRow.simpleRenderControls8394) {
    const d = derive8394Engine(placementRow.simpleRenderControls8394);
    if (d) zd = d.renderZoneDefaults;
  }
  const modeRaw =
    vo.blendMode ?? zd.blendMode ?? rd.back?.blendMode ?? rd.blendMode ?? "multiply";
  const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "multiply";
  const opRaw =
    vo.blendOpacity ?? zd.blendOpacity ?? rd.back?.blendOpacity ?? rd.blendOpacity ?? 1;
  const opacity = typeof opRaw === "number" && Number.isFinite(opRaw) ? Math.min(1, Math.max(0, opRaw)) : 1;
  return { blendMode: mode, blendOpacity: opacity };
}

function getVariantBackUrl(blank, variant) {
  return (
    (variant.images && variant.images.back && variant.images.back.downloadUrl) ||
    (blank.images && blank.images.back && blank.images.back.downloadUrl) ||
    null
  );
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

function createRegisterGenerateProductFlatRenders({ admin, db, storage, fetch, crypto }) {
  return functions
    .runWith({ memory: "1GB", timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
      try {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
      }

      const productId = data && data.productId;
      if (!productId || typeof productId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "productId is required");
      }

      const sharp = require("sharp");
      const productRef = db.collection("rp_products").doc(productId);
      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Product not found");
      }
      const product = productSnap.data();

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

      const blankVariantId = product.blankVariantId;
      if (!blankVariantId) {
        throw new functions.https.HttpsError("failed-precondition", "Product needs blankVariantId for MVP render");
      }

      const variant = (blank.variants || []).find((v) => v.variantId === blankVariantId);
      if (!variant) {
        throw new functions.https.HttpsError("not-found", "Variant not found on blank");
      }
      if (variant.isActive === false) {
        throw new functions.https.HttpsError("failed-precondition", "Variant is inactive");
      }

      const placementRow = getBackPlacementRow(blank);
      if (!placementRow) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Blank has no back placement; configure placements on the blank (e.g. back_center)"
        );
      }
      const placementFingerprint = getBackPlacementFingerprintSlice(placementRow);

      const variantBackUrl = getVariantBackUrl(blank, variant);
      if (!variantBackUrl) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Variant has no back image URL; upload back image on the variant"
        );
      }

      const designId = (product.designIdBack && String(product.designIdBack).trim()) || product.designId;
      if (!designId) {
        throw new functions.https.HttpsError("failed-precondition", "Product has no designId (or designIdBack)");
      }

      const designSnap = await db.collection("designs").doc(designId).get();
      if (!designSnap.exists) {
        throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
      }
      const design = designSnap.data();

      const { url: designPngUrl, ref: designAssetRef } = pickDesignPngForVariant(design, variant);
      if (!designPngUrl) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Design missing usable PNG for this garment (light/dark)"
        );
      }

      const blend = resolveEffectiveRenderSettings(product, blank, variant, placementRow, "back");

      const fingerprintPayload = {
        scope: "step10_mvp_8394_back_v4",
        blankId,
        blankVariantId,
        blankVersion: getBlankVersionValue(blank),
        placementBack: placementFingerprint,
        backBlend: blend,
        variantBackUrl,
        designId,
        designVersion: getDesignVersionValue(design),
        designAssetRef,
        designAssetUrl: designPngUrl,
      };
      const inputFingerprint = fingerprintFromPayload(fingerprintPayload, crypto);

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

      const effPl = resolveEffectivePlacement(product, blank, "back");
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

      const bucket = storage.bucket();
      const ts = Date.now();
      const basePath = `rp_products/${productId}/flat_renders/${ts}`;

      async function uploadPng(suffix, buf) {
        const storagePath = `${basePath}_${suffix}.png`;
        const url = await savePngAndReadableUrl(bucket, storagePath, buf);
        return { storagePath, url };
      }

      const clean = await uploadPng("flat_clean_back", flatCleanBuffer);
      const blended = await uploadPng("flat_blended_back", flatBlendedBuffer);
      const now = admin.firestore.FieldValue.serverTimestamp();

      const slot = (lookType, view, url, storagePath) => ({
        url,
        storagePath,
        generatedAt: now,
        lookType,
        view,
        sourceBlankVariantId: blankVariantId,
        sourceDesignAssetRef: designAssetRef,
        inputFingerprint,
      });

      const flatRenders = {
        flat_clean: {
          back: slot("flat_clean", "back", clean.url, clean.storagePath),
        },
        flat_blended: {
          back: slot("flat_blended", "back", blended.url, blended.storagePath),
        },
      };

      await productRef.update({
        flatRenders,
        updatedAt: now,
        updatedBy: context.auth.uid,
      });

      return {
        ok: true,
        productId,
        inputFingerprint,
        urls: { flat_clean_back: clean.url, flat_blended_back: blended.url },
      };
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

module.exports = { createRegisterGenerateProductFlatRenders };
