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

/**
 * Validate + normalize a job's input fields the same way for sync callable and async
 * trigger entry points. Throws an `HttpsError` for the sync callable; the trigger
 * catches and writes the error message into the job doc.
 */
function validatePreviewInput(functions, data) {
  const { blankId, variantId, designId, view, placement: pl, artworkMode: artworkModeIn, withRealism: withRealismIn } = data || {};
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
  return {
    blankId,
    variantId: variantId || null,
    designId,
    view,
    artworkMode,
    placement: pl,
    withRealism: withRealismIn === true,
  };
}

/**
 * Stage A composite — same algorithm `onMockJobCreated` Stage A uses, in lib form so
 * both the sync callable (`previewBlankRender` with withRealism=false) and the async
 * trigger (`onBlankPreviewJobCreated`) call the same code path.
 *
 * Returns the persisted `stageA` summary plus the in-memory buffer/meta needed to chain
 * into Stage B without re-loading from Storage.
 */
async function composeStageA({ db, storage, sharp, functions, input }) {
  const { blankId, variantId, designId, view, artworkMode, placement: pl } = input;

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
  const blank = blankSnap.data();

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
  const nativeBlankBuffer = Buffer.from(await blankResp.arrayBuffer());

  /**
   * Oversample the entire composite: render at 2× the blank's native resolution, then
   * downsample once to native at the very end. The design layer is sized in the 2× space
   * (e.g. 864×540 instead of 432×270 for HF07's chest panel at scale=0.4), so Sharp's
   * intermediate resize keeps far more detail. The final single-pass downsample uses
   * lanczos3 and produces a sharp result. Net effect: the design's text edges look
   * crisp in the displayed PNG, matching what the CSS canvas previews.
   *
   * Trade-off: 4× the pixels through Sharp, 4× the upload bytes for the preview PNG.
   * Stage A goes from ~3s → ~6s and from ~250KB → ~1MB for a typical HF07 render.
   * Worth it for preview accuracy.
   */
  const OVERSAMPLE = 2;
  const nativeBlankMeta = await sharp(nativeBlankBuffer).metadata();
  const nativeBlankW = nativeBlankMeta.width || 1500;
  const nativeBlankH = nativeBlankMeta.height || 1500;
  const blankBuffer = await sharp(nativeBlankBuffer)
    .resize(nativeBlankW * OVERSAMPLE, nativeBlankH * OVERSAMPLE, { kernel: "lanczos3" })
    .toBuffer();

  const designResp = await fetch(designPngUrl);
  if (!designResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch design PNG (HTTP ${designResp.status})`);
  let designBuffer = Buffer.from(await designResp.arrayBuffer());

  /**
   * Use the design PNG's NATURAL dimensions (no artwork-bounds crop). The CSS canvas in
   * the editor renders the full uncropped artboard with `object-contain`; cropping in
   * Stage A produced a different visual layout for any design with transparent padding,
   * which broke "what you see is what production produces." Now both surfaces composite
   * the same buffer: full design PNG → fit-inside the art box → place at center.
   *
   * Trade-off: padded artboards render with their padding visible (just like the CSS
   * canvas shows them). Designers should tightly crop their artboards — or use the
   * artboard as the canonical placement reference, which is what the CSS canvas
   * has always implied via the fixed `DESIGN_ARTBOARD_WIDTH_PX / HEIGHT_PX` constants.
   */
  const designMeta = await sharp(designBuffer).metadata();
  const designWidth = designMeta.width || 1;
  const designHeight = designMeta.height || 1;

  const blankMeta = await sharp(blankBuffer).metadata();
  const blankWidth = blankMeta.width;
  const blankHeight = blankMeta.height;
  if (!blankWidth || !blankHeight) {
    throw new functions.https.HttpsError("internal", "Garment image has no readable dimensions");
  }

  const x = Number.isFinite(Number(pl.x)) ? Number(pl.x) : 0.5;
  const y = Number.isFinite(Number(pl.y)) ? Number(pl.y) : 0.5;
  const effectiveScale = Number.isFinite(Number(pl.scale)) ? Number(pl.scale) : 0.6;
  const centerXpx = Math.round(x * blankWidth);
  const centerYpx = Math.round(y * blankHeight);
  let artBoxPxW;
  let artBoxPxH;
  if (Number.isFinite(Number(pl.width)) && Number.isFinite(Number(pl.height)) && Number(pl.width) > 0 && Number(pl.height) > 0) {
    artBoxPxW = Math.round(blankWidth * Number(pl.width) * effectiveScale);
    artBoxPxH = Math.round(blankHeight * Number(pl.height) * effectiveScale);
  } else {
    artBoxPxW = Math.round(blankWidth * 0.5 * effectiveScale);
    artBoxPxH = Math.round(blankHeight * 0.5 * effectiveScale);
  }
  let left = Math.round(centerXpx - artBoxPxW / 2);
  let top = Math.round(centerYpx - artBoxPxH / 2);

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

  /**
   * Print-realism treatment defaults to NO-OP. Blanks that want fabric softness can opt
   * in via `placement.printBlurSigma` / `printSaturation`. Resize kernel is `lanczos2`
   * (sharper than lanczos3 default) — text designs survive the downsample better with
   * less halo softening, which was the visible "blurriness" in earlier Stage A previews.
   */
  const printBlurSigma = Number.isFinite(Number(pl.printBlurSigma)) ? Number(pl.printBlurSigma) : 0;
  const printSaturation = Number.isFinite(Number(pl.printSaturation)) ? Number(pl.printSaturation) : 1.0;
  let resizePipeline = sharp(designBuffer).resize(resizedWidth, resizedHeight, { fit: "inside", kernel: "lanczos2" });
  if (printBlurSigma > 0) resizePipeline = resizePipeline.blur(printBlurSigma);
  if (printSaturation !== 1.0) resizePipeline = resizePipeline.modulate({ saturation: printSaturation });
  const resizedResult = await resizePipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ depth: 8, resolveWithObject: true });
  const resizedDesignRaw = resizedResult.data;
  const actualW = resizedResult.info.width;
  const actualH = resizedResult.info.height;

  const blendModeRequested = typeof pl.blendMode === "string" && pl.blendMode.length > 0 ? pl.blendMode : "soft-light";
  const blendMode = normalizeBlendModeForSharp(blendModeRequested);
  const effectiveOpacity = Number.isFinite(Number(pl.blendOpacity)) ? Number(pl.blendOpacity) : 0.9;

  /**
   * Compute the design's actual top-left on the garment BEFORE applying the mask, so
   * we extract the matching mask region from the same coordinate space. The original
   * `left/top` are the art-box top-left; the design (fit: inside) is centered within
   * that art box, so its true position is offset by half the size difference.
   * Clamp inside the blank so extract() never goes out of bounds.
   */
  const designLeft = Math.max(0, Math.min(Math.round(left + (artBoxPxW - actualW) / 2), blankWidth - actualW));
  const designTop = Math.max(0, Math.min(Math.round(top + (artBoxPxH - actualH) / 2), blankHeight - actualH));

  let maskApplied = false;
  let maskMean = null;
  const maskMode = pl.maskConfig && typeof pl.maskConfig.mode === "string" ? pl.maskConfig.mode : null;
  try {
    const maskDocId = `${blankId}_${view}`;
    const maskDoc = maskMode === "none" ? null : await db.collection("rp_blank_masks").doc(maskDocId).get();
    const maskData = maskDoc && maskDoc.exists ? maskDoc.data() : null;
    if (maskData && maskData.mask && maskData.mask.downloadUrl) {
      const maskResp = await fetch(maskData.mask.downloadUrl);
      if (maskResp.ok) {
        /**
         * Resize the mask to BLANK dimensions (it was authored in garment coordinate
         * space), then extract the sub-region that overlaps the design's placement.
         * Previously we stretched the whole mask into the design's bounding box with
         * `fit: "fill"` — which compressed the sweatshirt silhouette into a thin band
         * and clipped most of the design away. The extract path is geometrically
         * correct: only the bit of the mask actually under the design gets multiplied.
         */
        const maskResult = await sharp(await maskResp.arrayBuffer())
          .resize(blankWidth, blankHeight, { fit: "fill" })
          .extract({ left: designLeft, top: designTop, width: actualW, height: actualH })
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
        /**
         * Empty-mask sanity check. The extracted region is the part of the mask under
         * the design's footprint, NOT the whole mask. Three cases:
         *   - Mean very low (~0): the design sits outside the print zone — skip; the
         *     multiply would zero out the entire design.
         *   - Mean very high (~255): the design sits fully inside the print zone — the
         *     multiply is a no-op (white = identity for multiply), but apply anyway so
         *     the badge reads "Mask applied" consistently.
         *   - Mean in between: design straddles the print-zone boundary — apply normally.
         *
         * The old upper bound of 230 incorrectly rejected the no-op case (mean=255 for a
         * design fully inside a sweatshirt-body silhouette) and made it look like the mask
         * was broken. There's no real inversion case to detect at extract time — the
         * SAM upload step already normalizes to strict black/white.
         */
        const looksUsable = maskMean >= 5;
        if (looksUsable) {
          for (let i = 0; i < resizedDesignRaw.length; i += 4) {
            const m = maskBuffer[i];
            resizedDesignRaw[i] = Math.round((resizedDesignRaw[i] * m) / 255);
            resizedDesignRaw[i + 1] = Math.round((resizedDesignRaw[i + 1] * m) / 255);
            resizedDesignRaw[i + 2] = Math.round((resizedDesignRaw[i + 2] * m) / 255);
            resizedDesignRaw[i + 3] = Math.round((resizedDesignRaw[i + 3] * m) / 255);
          }
          maskApplied = true;
        } else {
          console.log(`[composeStageA] Skipping mask (mean=${Math.round(maskMean)} < 5; design likely outside print zone)`);
        }
      }
    }
  } catch (maskErr) {
    console.warn("[composeStageA] mask apply failed:", maskErr && maskErr.message);
  }

  const designWithOpacity = applyOpacityToRgbaBuffer(resizedDesignRaw, effectiveOpacity);
  const designPremultiplied = premultiplyRgbaBuffer(designWithOpacity);
  const designForComposite = await sharp(designPremultiplied, {
    raw: { width: actualW, height: actualH, channels: 4, premultiplied: true },
  })
    .png()
    .toBuffer();

  /** Composite at the same designLeft/designTop the mask extract used — keeps mask + design aligned. */
  const oversampledComposite = await sharp(blankBuffer)
    .composite([{ input: designForComposite, left: designLeft, top: designTop, blend: blendMode, premultiplied: true }])
    .png()
    .toBuffer();

  /**
   * Single high-quality downsample from the 2× working space back to native blank
   * dimensions. The design layer had 4× more pixels through the compose pipeline, so
   * after this one-pass downsample to native, text edges stay crisp. Final PNG is the
   * same size as before the oversampling change — no bandwidth penalty downstream.
   */
  const previewBuffer = await sharp(oversampledComposite)
    .resize(nativeBlankW, nativeBlankH, { kernel: "lanczos3" })
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

  return {
    stageA: {
      previewUrl: downloadUrl,
      storagePath,
      width: stageAMeta.width || blankWidth,
      height: stageAMeta.height || blankHeight,
      bytes: previewBuffer.length,
      maskApplied,
      maskMean: maskMean != null ? Math.round(maskMean) : null,
      maskMode,
      placementUsed: { x, y, scale: effectiveScale, blendMode: blendModeRequested, blendOpacity: effectiveOpacity },
    },
    /** Chained handoff for Stage B — kept in memory so we don't re-fetch. */
    draftBuffer: previewBuffer,
    draftMeta: stageAMeta,
    variantSuffix,
    timestamp,
    variant,
  };
}

/**
 * Stage B (AI realism) — runs fal.ai realism pass on Stage A output, saves the result
 * to Storage, returns the persisted `stageB` summary.
 */
async function composeStageB({ db, storage, sharp, functions, blankId, view, draftBuffer, draftMeta, variantSuffix, timestamp }) {
  const falApiKey = getFalApiKey(functions);
  if (!falApiKey) {
    throw new Error("FAL_API_KEY is not configured — cannot run AI realism pass");
  }
  const realism = await runRealismPass({
    sharp,
    db,
    fetchFn: fetch,
    falApiKey,
    blankId,
    view,
    draftBuffer,
    draftMeta,
  });
  const realismMeta = await sharp(realism.buffer).metadata();
  const realismToken = `${timestamp}_realism_${Math.floor(Math.random() * 1e6).toString(16)}`;
  const realismPath = `rp/blank_previews/${blankId}/${view}/_preview${variantSuffix}_${timestamp}_realism.png`;
  const bucket = storage.bucket();
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
  return {
    stageB: {
      previewUrl: realismUrl,
      storagePath: realismPath,
      bytes: realism.buffer.length,
      width: realismMeta.width || draftMeta.width,
      height: realismMeta.height || draftMeta.height,
      falEndpoint: realism.falEndpoint,
      usedMask: realism.useMask,
      params: realism.params,
    },
  };
}

function buildPreviewBlankRender({ db, storage, functions, sharp, admin }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);
    const input = validatePreviewInput(functions, data);

    /**
     * Async path: when realism is requested, the sync HTTP gateway times out at ~60s
     * (flux inpaint + polling = 30–60s). Enqueue a job doc and return its ID; the
     * trigger `onBlankPreviewJobCreated` runs Stage A then Stage B and writes results
     * back to the doc. The client subscribes via `onSnapshot` and progresses the UI.
     */
    if (input.withRealism) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      const jobData = {
        blankId: input.blankId,
        variantId: input.variantId,
        designId: input.designId,
        view: input.view,
        artworkMode: input.artworkMode,
        placement: input.placement,
        withRealism: true,
        status: "queued",
        error: null,
        stageA: null,
        stageB: null,
        createdAt: now,
        createdByUid: uid,
        updatedAt: now,
      };
      const jobRef = await db.collection("rp_blank_preview_jobs").add(jobData);
      return { jobId: jobRef.id, status: "queued" };
    }

    /** Sync path: Stage A only — fast enough to finish well within the gateway window. */
    const { stageA, variant } = await composeStageA({ db, storage, sharp, functions, input });
    return {
      previewUrl: stageA.previewUrl,
      storagePath: stageA.storagePath,
      width: stageA.width,
      height: stageA.height,
      bytes: stageA.bytes,
      stage: "A",
      stageA,
      stageB: null,
      maskApplied: stageA.maskApplied,
      maskMean: stageA.maskMean,
      maskMode: stageA.maskMode,
      artworkMode: input.artworkMode,
      placementUsed: stageA.placementUsed,
      variantId: variant ? variant.variantId : null,
    };
  };
}

/**
 * Firestore trigger that drains `rp_blank_preview_jobs/{jobId}`. Runs Stage A → writes
 * `stageA`, then (when `withRealism`) Stage B → writes `stageB`, then sets
 * status="completed". On any error, writes status="failed" + error message.
 *
 * The client subscribes to the doc via `onSnapshot` and renders progressive UI
 * (queued → stageA visible → stageB visible / failed). This bypasses the synchronous
 * Firebase callable HTTP gateway's ~60s ceiling.
 */
function buildOnBlankPreviewJobCreated({ db, storage, admin, functions, sharp }) {
  return async (snap, eventContext) => {
    const job = snap.data();
    const jobId = eventContext && eventContext.params ? eventContext.params.jobId : (snap.id || "?");
    if (!job || job.status !== "queued") {
      console.log(`[onBlankPreviewJobCreated] Job ${jobId} not queued (status=${job && job.status}), skipping`);
      return;
    }

    const jobRef = db.collection("rp_blank_preview_jobs").doc(jobId);
    const tick = () => admin.firestore.FieldValue.serverTimestamp();

    try {
      await jobRef.update({ status: "processing", updatedAt: tick() });

      const input = {
        blankId: job.blankId,
        variantId: job.variantId || null,
        designId: job.designId,
        view: job.view,
        artworkMode: job.artworkMode || "light",
        placement: job.placement || {},
        withRealism: job.withRealism === true,
      };

      const stageAResult = await composeStageA({ db, storage, sharp, functions, input });
      await jobRef.update({ stageA: stageAResult.stageA, updatedAt: tick() });
      console.log(`[onBlankPreviewJobCreated] Job ${jobId} Stage A done`);

      if (input.withRealism) {
        const stageBResult = await composeStageB({
          db,
          storage,
          sharp,
          functions,
          blankId: input.blankId,
          view: input.view,
          draftBuffer: stageAResult.draftBuffer,
          draftMeta: stageAResult.draftMeta,
          variantSuffix: stageAResult.variantSuffix,
          timestamp: stageAResult.timestamp,
        });
        await jobRef.update({ stageB: stageBResult.stageB, updatedAt: tick() });
        console.log(`[onBlankPreviewJobCreated] Job ${jobId} Stage B done`);
      }

      await jobRef.update({ status: "completed", updatedAt: tick() });
      console.log(`[onBlankPreviewJobCreated] Job ${jobId} completed`);
    } catch (err) {
      console.error(`[onBlankPreviewJobCreated] Job ${jobId} failed:`, err && err.message);
      await jobRef
        .update({
          status: "failed",
          error: err && err.message ? String(err.message) : "Unknown error",
          updatedAt: tick(),
        })
        .catch((updateErr) => {
          console.error(`[onBlankPreviewJobCreated] Failed to record error on ${jobId}:`, updateErr && updateErr.message);
        });
    }
  };
}

module.exports = { buildPreviewBlankRender, buildOnBlankPreviewJobCreated };
