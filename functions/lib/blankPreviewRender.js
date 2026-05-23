"use strict";

/**
 * Real-render preview on the blank Render profile tab.
 *
 * Runs the same deterministic Sharp pipeline `onMockJobCreated` Stage A uses, but at the
 * BLANK level — no product, no rp_mock_jobs doc, no AI realism pass. Lets an operator
 * tune placement + blend + opacity + mask, click "Render preview," and see a real PNG
 * before fanning out to N products.
 *
 * Spec: RALLY_BLANK_PREVIEW_RENDER.md
 */

const { resolveDesignAssetUrls } = require("./designFileMergeCore");

const VARIANT_FLAT_FRONT_KEYS = ["flatFront", "front"];
const VARIANT_FLAT_BACK_KEYS = ["flatBack", "back"];

/**
 * Sharp's composite() uses `"over"` for the standard normal/source-over operation; it
 * rejects `"normal"` with `Expected valid blend name for blend but received normal`.
 * The editor (and CSS mix-blend-mode) speaks "normal," so normalize at the boundary.
 */
const CSS_TO_SHARP_BLEND = {
  normal: "over",
  source: "over",
  "source-over": "over",
};

function normalizeBlendModeForSharp(mode) {
  if (typeof mode !== "string" || mode.length === 0) return "soft-light";
  return CSS_TO_SHARP_BLEND[mode] || mode;
}

function pickRefImage(blank, variant, view) {
  const variantImages = (variant && variant.images) || null;
  const keys = view === "front" ? VARIANT_FLAT_FRONT_KEYS : VARIANT_FLAT_BACK_KEYS;
  if (variantImages) {
    for (const k of keys) {
      const ref = variantImages[k];
      if (ref && ref.downloadUrl) return String(ref.downloadUrl);
    }
  }
  const top = blank && blank.images && blank.images[view];
  if (top && top.downloadUrl) return String(top.downloadUrl);
  return null;
}

/**
 * Mirror `designPngUrlForProcessing` in index.js: delegates to the shared resolver in
 * designFileMergeCore (which handles `files.{side}.lightPng.downloadUrl` etc.) so this
 * preview matches what the production pipeline picks for the same design.
 */
function pickDesignPngUrl(design) {
  if (!design) return null;
  const u = resolveDesignAssetUrls(design);
  return u.lightPng || u.darkPng || u.whitePng || null;
}

/**
 * Duplicates of helpers in index.js (applyOpacityToRgbaBuffer, premultiplyRgbaBuffer,
 * cropDesignToArtworkBounds). When the same Stage A logic is needed by yet another
 * surface, extract these to a shared module.
 */
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

const ARTWORK_BOUNDS_ALPHA_THRESHOLD = 5;

async function cropDesignToArtworkBounds(sharp, designBuffer) {
  const meta = await sharp(designBuffer).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) return { buffer: designBuffer, width: w || 1, height: h || 1 };

  const raw = await sharp(designBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ depth: 8, resolveWithObject: false });

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
  if (boundsW < 1 || boundsH < 1) return { buffer: designBuffer, width: w, height: h };

  const cropped = await sharp(designBuffer)
    .extract({ left: minX, top: minY, width: boundsW, height: boundsH })
    .png()
    .toBuffer();
  return { buffer: cropped, width: boundsW, height: boundsH };
}

async function assertAdmin(db, functions, uid) {
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
  const snap = await db.collection("admins").doc(uid).get();
  if (!snap.exists) throw new functions.https.HttpsError("permission-denied", "Admins only");
}

function buildPreviewBlankRender({ db, storage, functions, sharp }) {
  return async (data, context) => {
    await assertAdmin(db, functions, context && context.auth && context.auth.uid);

    const { blankId, variantId, designId, view, placement: pl } = data || {};
    if (!blankId || typeof blankId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankId is required");
    }
    if (!designId || typeof designId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "designId is required");
    }
    if (view !== "front" && view !== "back") {
      throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
    }
    if (!pl || typeof pl !== "object") {
      throw new functions.https.HttpsError("invalid-argument", "placement is required");
    }

    const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
    if (!blankSnap.exists) throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
    const blank = blankSnap.data();

    /**
     * variantId can be a stored variants[].variantId or null (use first available).
     * Treat absence as "first variant with the required view image."
     */
    const variants = Array.isArray(blank.variants) ? blank.variants : [];
    const variant =
      (variantId && variants.find((v) => v && v.variantId === variantId)) ||
      variants.find((v) => v && pickRefImage(blank, v, view)) ||
      null;

    const refImageUrl = pickRefImage(blank, variant, view);
    if (!refImageUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `No ${view} image for this blank — upload a variant photo or a master image first`
      );
    }

    const designSnap = await db.collection("designs").doc(designId).get();
    if (!designSnap.exists) throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
    const design = designSnap.data();
    const designPngUrl = pickDesignPngUrl(design);
    if (!designPngUrl) {
      throw new functions.https.HttpsError("failed-precondition", "Design has no usable PNG (lightPng / darkPng / files.*.png)");
    }

    const blankResp = await fetch(refImageUrl);
    if (!blankResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch garment image (HTTP ${blankResp.status})`);
    const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

    const designResp = await fetch(designPngUrl);
    if (!designResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch design PNG (HTTP ${designResp.status})`);
    let designBuffer = Buffer.from(await designResp.arrayBuffer());

    const designMetaOriginal = await sharp(designBuffer).metadata();
    const originalDesignW = designMetaOriginal.width || 1;
    const originalDesignH = designMetaOriginal.height || 1;
    const cropResult = await cropDesignToArtworkBounds(sharp, designBuffer);
    designBuffer = cropResult.buffer;
    const designWidth = cropResult.width;
    const designHeight = cropResult.height;

    const blankMeta = await sharp(blankBuffer).metadata();
    const blankWidth = blankMeta.width;
    const blankHeight = blankMeta.height;
    if (!blankWidth || !blankHeight) {
      throw new functions.https.HttpsError("internal", "Garment image has no readable dimensions");
    }

    /** Match the placement math `onMockJobCreated` uses (lines ~7637–7659). */
    const x = Number.isFinite(Number(pl.x)) ? Number(pl.x) : 0.5;
    const y = Number.isFinite(Number(pl.y)) ? Number(pl.y) : 0.5;
    const effectiveScale = Number.isFinite(Number(pl.scale)) ? Number(pl.scale) : 0.6;
    const centerXpx = Math.round(x * blankWidth);
    const centerYpx = Math.round(y * blankHeight);
    let artBoxPxW, artBoxPxH, left, top;
    if (Number.isFinite(Number(pl.width)) && Number.isFinite(Number(pl.height)) && Number(pl.width) > 0 && Number(pl.height) > 0) {
      const fullPrintW = blankWidth * Number(pl.width);
      const fullPrintH = blankHeight * Number(pl.height);
      artBoxPxW = Math.round(fullPrintW * effectiveScale);
      artBoxPxH = Math.round(fullPrintH * effectiveScale);
    } else {
      const modalBase = 0.5;
      artBoxPxW = Math.round(blankWidth * modalBase * effectiveScale);
      artBoxPxH = Math.round(blankHeight * modalBase * effectiveScale);
    }
    left = Math.round(centerXpx - artBoxPxW / 2);
    top = Math.round(centerYpx - artBoxPxH / 2);

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

    const printBlurSigma = Number.isFinite(Number(pl.printBlurSigma)) ? Number(pl.printBlurSigma) : 0.3;
    const printSaturation = Number.isFinite(Number(pl.printSaturation)) ? Number(pl.printSaturation) : 0.96;
    const resizedResult = await sharp(designBuffer)
      .resize(resizedWidth, resizedHeight, { fit: "inside" })
      .blur(printBlurSigma)
      .modulate({ saturation: printSaturation })
      .ensureAlpha()
      .raw()
      .toBuffer({ depth: 8, resolveWithObject: true });
    let resizedDesignRaw = resizedResult.data;
    const actualW = resizedResult.info.width;
    const actualH = resizedResult.info.height;

    const blendModeRequested = typeof pl.blendMode === "string" && pl.blendMode.length > 0 ? pl.blendMode : "soft-light";
    const blendMode = normalizeBlendModeForSharp(blendModeRequested);
    const effectiveOpacity = Number.isFinite(Number(pl.blendOpacity)) ? Number(pl.blendOpacity) : 0.9;

    /**
     * Multiply rp_blank_masks/{blankId}_{view} onto the design RGBA. Three gates, same as
     * onMockJobCreated:
     *   1. `placement.maskConfig.mode === "none"` → skip (operator opted out).
     *      Null/undefined or "blank_mask_doc" → apply if a mask doc exists.
     *   2. Mask doc must exist with a downloadUrl.
     *   3. Mask must not look inverted (mean > 80).
     */
    let maskApplied = false;
    let maskMean = null;
    const maskMode =
      pl.maskConfig && typeof pl.maskConfig.mode === "string" ? pl.maskConfig.mode : null;
    try {
      if (maskMode === "none") {
        console.log("[previewBlankRender] Skipping fabric mask (maskConfig.mode='none')");
      }
      const maskDocId = `${blankId}_${view}`;
      const maskDoc = maskMode === "none" ? null : await db.collection("rp_blank_masks").doc(maskDocId).get();
      const maskData = maskDoc && maskDoc.exists ? maskDoc.data() : null;
      if (maskData && maskData.mask && maskData.mask.downloadUrl) {
        const maskResp = await fetch(maskData.mask.downloadUrl);
        if (maskResp.ok) {
          const maskResult = await sharp(await maskResp.arrayBuffer())
            .resize(actualW, actualH, { fit: "fill" })
            .grayscale()
            .ensureAlpha()
            .raw()
            .toBuffer({ depth: 8, resolveWithObject: true });
          const maskBuffer = maskResult.data;
          let sum = 0;
          let count = 0;
          for (let i = 0; i < maskBuffer.length; i += 4) {
            sum += maskBuffer[i];
            count++;
          }
          maskMean = count > 0 ? sum / count : 0;
          if (maskMean > 80) {
            for (let i = 0; i < resizedDesignRaw.length; i += 4) {
              const m = maskBuffer[i];
              resizedDesignRaw[i] = Math.round((resizedDesignRaw[i] * m) / 255);
              resizedDesignRaw[i + 1] = Math.round((resizedDesignRaw[i + 1] * m) / 255);
              resizedDesignRaw[i + 2] = Math.round((resizedDesignRaw[i + 2] * m) / 255);
              resizedDesignRaw[i + 3] = Math.round((resizedDesignRaw[i + 3] * m) / 255);
            }
            maskApplied = true;
          }
        }
      }
    } catch (maskErr) {
      console.warn("[previewBlankRender] mask apply failed:", maskErr && maskErr.message);
    }

    const designWithOpacity = applyOpacityToRgbaBuffer(resizedDesignRaw, effectiveOpacity);
    const designPremultiplied = premultiplyRgbaBuffer(designWithOpacity);
    const designForComposite = await sharp(designPremultiplied, {
      raw: { width: actualW, height: actualH, channels: 4, premultiplied: true },
    })
      .png()
      .toBuffer();

    left = Math.round(left + (artBoxPxW - actualW) / 2);
    top = Math.round(top + (artBoxPxH - actualH) / 2);
    left = Math.max(0, Math.min(left, blankWidth - actualW));
    top = Math.max(0, Math.min(top, blankHeight - actualH));

    const previewBuffer = await sharp(blankBuffer)
      .composite([{ input: designForComposite, left, top, blend: blendMode, premultiplied: true }])
      .png()
      .toBuffer();

    const timestamp = Date.now();
    const variantSuffix = variant && variant.variantId ? `_${variant.variantId}` : "";
    const storagePath = `rp/blank_previews/${blankId}/${view}/_preview${variantSuffix}_${timestamp}.png`;
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const downloadToken = `${timestamp}_${Math.floor(Math.random() * 1e6).toString(16)}`;
    await file.save(previewBuffer, {
      contentType: "image/png",
      metadata: {
        contentType: "image/png",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

    const finalMeta = await sharp(previewBuffer).metadata();
    return {
      previewUrl: downloadUrl,
      storagePath,
      width: finalMeta.width || blankWidth,
      height: finalMeta.height || blankHeight,
      bytes: previewBuffer.length,
      maskApplied,
      maskMean: maskMean != null ? Math.round(maskMean) : null,
      maskMode,
      designOriginalPx: { w: originalDesignW, h: originalDesignH },
      designCroppedPx: { w: designWidth, h: designHeight },
      designResizedPx: { w: actualW, h: actualH },
      placementUsed: { x, y, scale: effectiveScale, blendMode: blendModeRequested, blendOpacity: effectiveOpacity },
      variantId: variant ? variant.variantId : null,
    };
  };
}

module.exports = { buildPreviewBlankRender };
