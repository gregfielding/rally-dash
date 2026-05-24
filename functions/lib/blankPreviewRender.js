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

/**
 * Realism-pass prompts copied verbatim from `onMockJobCreated` Stage B (functions/index.js
 * ~line 8043). Keeping them in sync ensures preview output matches production. If you
 * tune these here, update production too.
 */
const REALISM_PROMPT =
  "Studio product photo of the same garment. The artwork is screen printed directly onto the fabric. Preserve garment shape, seams, and lighting. The print follows fabric texture and wrinkles with subtle ink absorption and shading. Keep the artwork geometry and edges exactly the same. Do not change background.";
const REALISM_NEGATIVE =
  "distort logo, change text, redraw artwork, add text, change garment shape, change straps/waistband, change background, add objects, blur";
const FAL_INPAINT_ENDPOINT = "fal-ai/flux/dev/inpainting";
const FAL_IMG2IMG_ENDPOINT = "fal-ai/flux/dev/image-to-image";
/** 90 attempts × 1500ms = 135s polling budget. Stage B usually completes within 30-60s. */
const REALISM_MAX_POLL_ATTEMPTS = 90;
const REALISM_POLL_INTERVAL_MS = 1500;

function getFalApiKey(functions) {
  try {
    const cfg = functions.config && functions.config();
    const keyFromConfig = cfg && cfg.fal && cfg.fal.key;
    return process.env.FAL_API_KEY || keyFromConfig;
  } catch (e) {
    return process.env.FAL_API_KEY;
  }
}

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
 * Pick the design PNG honoring the operator's Artwork variant choice (light / dark / white)
 * from the Render profile tab. Falls back through reasonable alternatives if the requested
 * variant isn't uploaded. Production (`onMockJobCreated`) currently always picks light-first;
 * the preview supports the explicit override so the editor can validate dark/white designs.
 */
function pickDesignPngUrl(design, artworkMode) {
  if (!design) return null;
  const u = resolveDesignAssetUrls(design);
  if (artworkMode === "dark") return u.darkPng || u.lightPng || u.whitePng || null;
  if (artworkMode === "white") return u.whitePng || u.lightPng || u.darkPng || null;
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

/**
 * Run the Stage B AI realism pass on a Stage A composite buffer. Mirrors
 * `onMockJobCreated` Stage B (functions/index.js ~lines 8032-8200) — inpaint if a mask
 * exists for this blank+view, img2img otherwise. Returns the realism PNG buffer + the
 * model endpoint actually used (for telemetry).
 *
 * Costs $ per call (fal.ai) and takes ~20-60s. Only run when explicitly requested.
 */
async function runRealismPass({ sharp, db, fetchFn, falApiKey, blankId, view, draftBuffer, draftMeta }) {
  const draftBase64 = draftBuffer.toString("base64");
  const draftDataUrl = `data:image/png;base64,${draftBase64}`;

  const maskDocId = `${blankId}_${view}`;
  const maskDoc = await db.collection("rp_blank_masks").doc(maskDocId).get();
  const maskData = maskDoc.exists ? maskDoc.data() : null;

  let useMask = false;
  let maskBase64 = null;
  let falEndpoint = FAL_IMG2IMG_ENDPOINT;

  if (maskData && maskData.mask && maskData.mask.downloadUrl) {
    try {
      const maskResp = await fetchFn(maskData.mask.downloadUrl);
      if (maskResp.ok) {
        let processedMaskBuffer = Buffer.from(await maskResp.arrayBuffer());
        const maskMeta = await sharp(processedMaskBuffer).metadata();
        if (maskMeta.width !== draftMeta.width || maskMeta.height !== draftMeta.height) {
          processedMaskBuffer = await sharp(processedMaskBuffer)
            .resize(draftMeta.width, draftMeta.height, { fit: "fill" })
            .png()
            .toBuffer();
        }
        processedMaskBuffer = await sharp(processedMaskBuffer)
          .grayscale()
          .threshold(128)
          .png()
          .toBuffer();
        maskBase64 = processedMaskBuffer.toString("base64");
        useMask = true;
        falEndpoint = FAL_INPAINT_ENDPOINT;
      }
    } catch (maskErr) {
      console.warn("[previewBlankRender Stage B] mask processing failed:", maskErr && maskErr.message);
    }
  }

  /**
   * Use the queue endpoint (matches onMockJobCreated). Sync (`fal.run`) returned
   * "Path /dev/inpainting not found" because fal.run doesn't accept multi-segment
   * endpoint slugs. The flux endpoints return images directly in the status response
   * once COMPLETED, so we don't need to fetch response_url at all.
   */
  const falUrl = `https://queue.fal.run/${falEndpoint}`;
  const falPayload = useMask && maskBase64
    ? {
        image_url: draftDataUrl,
        mask_url: `data:image/png;base64,${maskBase64}`,
        prompt: REALISM_PROMPT,
        negative_prompt: REALISM_NEGATIVE,
        strength: 0.25,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        enable_safety_checker: false,
      }
    : {
        image_url: draftDataUrl,
        prompt: REALISM_PROMPT,
        negative_prompt: REALISM_NEGATIVE,
        strength: 0.2,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        enable_safety_checker: false,
      };

  const submitResp = await fetchFn(falUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${falApiKey}` },
    body: JSON.stringify(falPayload),
  });
  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(`fal.ai realism submit failed (${submitResp.status}): ${errText}`);
  }
  const submitJson = await submitResp.json();
  const requestId = submitJson.request_id || submitJson.id;
  const statusUrl = submitJson.status_url;
  if (!statusUrl) {
    throw new Error(
      `fal.ai submit returned no status_url (request_id=${requestId || "missing"}). Submit shape: ${JSON.stringify(Object.keys(submitJson))}`
    );
  }

  /**
   * Poll status_url until images appear (or status flips to COMPLETED with images
   * inline). The flux endpoints embed result `images[]` in the status response itself
   * once inference completes — same pattern onMockJobCreated reads at index.js:8169.
   * Some status responses include `images` even while status is still "IN_PROGRESS";
   * treat either signal as completion.
   */
  let resultJson = null;
  if (submitJson.images || (submitJson.output && submitJson.output.images)) {
    resultJson = submitJson;
  } else {
    let completed = false;
    /** Pass `?logs=1` so fal.ai includes intermediate fields in the status payload. */
    const statusUrlWithLogs = statusUrl.includes("?") ? `${statusUrl}&logs=1` : `${statusUrl}?logs=1`;
    for (let i = 0; i < REALISM_MAX_POLL_ATTEMPTS && !completed; i++) {
      await new Promise((resolve) => setTimeout(resolve, REALISM_POLL_INTERVAL_MS));
      const statusResp = await fetchFn(statusUrlWithLogs, {
        headers: { Authorization: `Key ${falApiKey}` },
      });
      if (!statusResp.ok) continue;
      const statusJson = await statusResp.json();
      if (statusJson.status === "FAILED") {
        throw new Error(`fal.ai realism job failed: ${statusJson.error || "unknown"}`);
      }
      if (statusJson.images || (statusJson.output && statusJson.output.images)) {
        resultJson = statusJson;
        completed = true;
      }
    }
    if (!completed) {
      throw new Error("fal.ai realism job timed out without returning images");
    }
  }

  const resultImages = resultJson.images || (resultJson.output && resultJson.output.images) || [];
  if (!Array.isArray(resultImages) || resultImages.length === 0) {
    throw new Error(
      `fal.ai returned no realism images. Response keys: ${JSON.stringify(Object.keys(resultJson))}`
    );
  }
  const resultUrl = typeof resultImages[0] === "string" ? resultImages[0] : resultImages[0].url;
  if (!resultUrl) throw new Error("fal.ai realism result missing image URL");

  const dlResp = await fetchFn(resultUrl);
  if (!dlResp.ok) throw new Error(`Failed to download realism image (HTTP ${dlResp.status})`);
  const realismBuffer = Buffer.from(await dlResp.arrayBuffer());

  return {
    buffer: realismBuffer,
    falEndpoint,
    useMask,
    params: {
      strength: useMask ? 0.25 : 0.2,
      num_inference_steps: 28,
      guidance_scale: 3.5,
    },
  };
}

function buildPreviewBlankRender({ db, storage, functions, sharp }) {
  return async (data, context) => {
    await assertAdmin(db, functions, context && context.auth && context.auth.uid);

    const {
      blankId,
      variantId,
      designId,
      view,
      placement: pl,
      artworkMode: artworkModeIn,
      withRealism: withRealismIn,
    } = data || {};
    const artworkMode = artworkModeIn === "dark" || artworkModeIn === "white" ? artworkModeIn : "light";
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
    const designPngUrl = pickDesignPngUrl(design, artworkMode);
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

    const stageAMeta = await sharp(previewBuffer).metadata();

    /**
     * Stage B (AI realism) is opt-in via `withRealism: true`. Costs $ + 20–60s of latency;
     * the operator triggers it explicitly when they want a realism-pass preview before
     * bulk-generating products. Mirrors `onMockJobCreated` Stage B with the same fal.ai
     * endpoints and prompts.
     */
    let realismResult = null;
    if (withRealismIn === true) {
      const falApiKey = getFalApiKey(functions);
      if (!falApiKey) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "FAL_API_KEY is not configured — cannot run AI realism pass"
        );
      }
      const realism = await runRealismPass({
        sharp,
        db,
        fetchFn: fetch,
        falApiKey,
        blankId,
        view,
        draftBuffer: previewBuffer,
        draftMeta: stageAMeta,
      });
      const realismMeta = await sharp(realism.buffer).metadata();
      const realismToken = `${timestamp}_realism_${Math.floor(Math.random() * 1e6).toString(16)}`;
      const realismPath = `rp/blank_previews/${blankId}/${view}/_preview${variantSuffix}_${timestamp}_realism.png`;
      const realismFile = bucket.file(realismPath);
      await realismFile.save(realism.buffer, {
        contentType: "image/png",
        metadata: {
          contentType: "image/png",
          metadata: { firebaseStorageDownloadTokens: realismToken },
        },
        resumable: false,
      });
      const realismUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(realismPath)}?alt=media&token=${realismToken}`;
      realismResult = {
        previewUrl: realismUrl,
        storagePath: realismPath,
        bytes: realism.buffer.length,
        width: realismMeta.width || stageAMeta.width || blankWidth,
        height: realismMeta.height || stageAMeta.height || blankHeight,
        falEndpoint: realism.falEndpoint,
        usedMask: realism.useMask,
        params: realism.params,
      };
    }

    /**
     * When realism ran, return its URL as the "primary" so the UI just shows the final pass.
     * Stage A is still available under `stageA` for comparison if a future UI wants it.
     */
    const primary = realismResult ?? {
      previewUrl: downloadUrl,
      storagePath,
      bytes: previewBuffer.length,
      width: stageAMeta.width || blankWidth,
      height: stageAMeta.height || blankHeight,
    };

    return {
      previewUrl: primary.previewUrl,
      storagePath: primary.storagePath,
      width: primary.width,
      height: primary.height,
      bytes: primary.bytes,
      stage: realismResult ? "B" : "A",
      stageA: {
        previewUrl: downloadUrl,
        storagePath,
        width: stageAMeta.width || blankWidth,
        height: stageAMeta.height || blankHeight,
        bytes: previewBuffer.length,
      },
      stageB: realismResult,
      maskApplied,
      maskMean: maskMean != null ? Math.round(maskMean) : null,
      maskMode,
      artworkMode,
      designOriginalPx: { w: originalDesignW, h: originalDesignH },
      designCroppedPx: { w: designWidth, h: designHeight },
      designResizedPx: { w: actualW, h: actualH },
      placementUsed: { x, y, scale: effectiveScale, blendMode: blendModeRequested, blendOpacity: effectiveOpacity },
      variantId: variant ? variant.variantId : null,
    };
  };
}

module.exports = { buildPreviewBlankRender };
