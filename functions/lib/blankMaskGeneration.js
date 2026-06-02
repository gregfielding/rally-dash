"use strict";

/**
 * Auto-generate blank print-zone masks via SAM (Segment Anything) on fal.ai.
 *
 * Two callables exposed via factory functions, mirroring `createCreateGenerationJob`:
 *
 *   generateBlankMaskViaSam
 *     - Reads the blank's reference image, asks SAM for a text-prompted segmentation,
 *       normalizes the result to strict B/W at the reference dimensions, saves to
 *       Storage at `rp/blank_masks/{blankId}/{view}/_ai_preview_{timestamp}.png`,
 *       returns the preview URL + metadata. Does NOT touch `rp_blank_masks/...`.
 *
 *   commitBlankMaskFromPreview
 *     - Promotes a preview file to the canonical `rp/blank_masks/{blankId}/{view}/mask.png`
 *       and writes `rp_blank_masks/{blankId}_{view}` with source/prompt/seed/lockedAt.
 *       Best-effort cleanup of the preview file.
 *
 * Spec: RALLY_BLANK_MASK_AI_AUTOGEN.md
 */

const { runFalInference } = require("./falInference");

const DEFAULT_SAM_ENDPOINT = "fal-ai/evf-sam";
/**
 * SAM-family models segment by concrete nouns, not anatomical region descriptions.
 * "chest panel inside seams" returned empty masks; "chest" / "upper back" land on
 * the garment torso reliably for EVF-SAM. Operators can override per-call.
 *
 * Model-pose prompts target the visible garment area on the model body rather
 * than a generic "chest" because on a model the torso includes skin, hair, and
 * background that we don't want included.
 */
const DEFAULT_PROMPT_FRONT = "chest";
const DEFAULT_PROMPT_BACK = "upper back";
const DEFAULT_PROMPT_MODEL_FRONT = "shirt front, the visible fabric on the chest";
const DEFAULT_PROMPT_MODEL_BACK = "shirt back, the visible fabric on the back";

const VALID_RENDER_TARGETS = new Set([
  "flat_front",
  "flat_back",
  "model_front",
  "model_back",
]);
const FAL_QUEUE_BASE = "https://queue.fal.run";
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;
/** Reject masks outside this grayscale-mean range (catches inverted / near-empty results). */
const MEAN_MIN = 30;
const MEAN_MAX = 230;

function getFalApiKey(functions) {
  try {
    const cfg = functions.config && functions.config();
    const keyFromConfig = cfg && cfg.fal && cfg.fal.key;
    return process.env.FAL_API_KEY || keyFromConfig;
  } catch (e) {
    return process.env.FAL_API_KEY;
  }
}

function getSamEndpoint(functions) {
  try {
    const cfg = functions.config && functions.config();
    const cfgEndpoint = cfg && cfg.rp && cfg.rp.sam_endpoint;
    return process.env.RP_SAM_ENDPOINT || cfgEndpoint || DEFAULT_SAM_ENDPOINT;
  } catch (e) {
    return process.env.RP_SAM_ENDPOINT || DEFAULT_SAM_ENDPOINT;
  }
}

async function assertAdmin(db, functions, uid) {
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
  }
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Admins only");
  }
}

/**
 * Pick the image URL the SAM endpoint will segment.
 *
 * - `flat_front` / `flat_back`: shared across colors — try the blank's top-level
 *   image, then fall back to any variant's flat photo. Same as the legacy behavior.
 * - `model_front` / `model_back`: per-variant — must read the specific
 *   `variant.images.modelFront/Back`. variantId is required; no fallback to
 *   another variant (each model photo has unique geometry).
 */
function pickRefImageUrl(blank, view, renderTarget, variantId) {
  const target = renderTarget || `flat_${view}`;
  if (target === "model_front" || target === "model_back") {
    if (!variantId) return null;
    const variant = Array.isArray(blank && blank.variants)
      ? blank.variants.find((v) => v && v.variantId === variantId)
      : null;
    if (!variant) return null;
    const im = variant.images || {};
    const ref = target === "model_front" ? im.modelFront : im.modelBack;
    return ref && ref.downloadUrl ? String(ref.downloadUrl) : null;
  }

  /** Flat path (unchanged from legacy). */
  const direct = blank && blank.images && blank.images[view];
  if (direct && direct.downloadUrl) return String(direct.downloadUrl);
  if (Array.isArray(blank && blank.variants)) {
    for (const v of blank.variants) {
      const im = v && v.images;
      const ref = im && (view === "front" ? im.flatFront || im.front : im.flatBack || im.back);
      if (ref && ref.downloadUrl) return String(ref.downloadUrl);
    }
  }
  return null;
}

/**
 * Build the canonical storage prefix + doc id for a (blank, view, renderTarget,
 * variantId?) tuple. Flat masks keep their legacy `{blankId}/{view}` layout so
 * existing files and docs continue to resolve; model masks use a richer key.
 */
function maskKeyFor(blankId, view, renderTarget, variantId) {
  const target = renderTarget || `flat_${view}`;
  if (target === "model_front" || target === "model_back") {
    if (!variantId) {
      throw new Error(`maskKeyFor: variantId is required for renderTarget="${target}"`);
    }
    return {
      docId: `${blankId}_${variantId}_${target}`,
      storageDir: `rp/blank_masks/${blankId}/${variantId}/${target}`,
    };
  }
  return {
    docId: `${blankId}_${view}`,
    storageDir: `rp/blank_masks/${blankId}/${view}`,
  };
}

/**
 * Pick the default SAM prompt for a render target. Operators can override per
 * call but the default matches what EVF-SAM expects to land cleanly.
 */
function defaultPromptFor(renderTarget, view) {
  const target = renderTarget || `flat_${view}`;
  if (target === "model_front") return DEFAULT_PROMPT_MODEL_FRONT;
  if (target === "model_back") return DEFAULT_PROMPT_MODEL_BACK;
  if (target === "flat_back") return DEFAULT_PROMPT_BACK;
  return DEFAULT_PROMPT_FRONT;
}

/**
 * Submit to fal.ai queue, poll until COMPLETED, return the first result image URL
 * plus Phase A cost/latency telemetry (so the callable can stamp it on the
 * preview return value, eventually on the rp_blank_masks doc).
 *
 * Endpoint extraction shape (SAM-family) is endpoint-specific — different
 * SAM variants embed the mask under image.url, images[0].url, mask.url, masks[0],
 * or output[0]. Probe in a fixed order so an operator can flip
 * RP_SAM_ENDPOINT to a different SAM-family endpoint without a code change.
 *
 * @returns {Promise<{maskUrl: string, costUsd: number|null, latencyMs: number, requestId: string|null}>}
 */
async function runSam(falApiKey, endpoint, imageUrl, prompt, seed) {
  /**
   * Default endpoint is `fal-ai/evf-sam` which takes `prompt` + `image_url`.
   * `text_prompt` is included for compatibility with grounded-sam-family endpoints if
   * an operator points `RP_SAM_ENDPOINT` at one. Extra unrecognized fields are usually
   * ignored — keep `seed` for deterministic re-rolls.
   */
  const body = {
    image_url: imageUrl,
    prompt: prompt,
    text_prompt: prompt,
    seed: seed,
  };

  const inference = await runFalInference({
    endpoint,
    payload: body,
    falApiKey,
    maxPollAttempts: MAX_POLL_ATTEMPTS,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
  const resultJson = inference.result;

  /**
   * Different fal.ai SAM-family endpoints return masks under different keys
   * (`image.url`, `images[0].url`, `mask.url`, `masks[0].url`, `output[0]`).
   * Probe in a fixed order.
   */
  const candidates = [
    resultJson.image && resultJson.image.url,
    Array.isArray(resultJson.images) && resultJson.images[0] && (resultJson.images[0].url || resultJson.images[0]),
    resultJson.mask && resultJson.mask.url,
    Array.isArray(resultJson.masks) && resultJson.masks[0] && (resultJson.masks[0].url || resultJson.masks[0]),
    Array.isArray(resultJson.output) && (typeof resultJson.output[0] === "string" ? resultJson.output[0] : resultJson.output[0] && resultJson.output[0].url),
    resultJson.url,
  ];
  const maskUrl = candidates.find((u) => typeof u === "string" && u.length > 0);
  if (!maskUrl) {
    throw new Error("fal.ai returned no usable mask URL — endpoint contract may have changed");
  }
  return {
    maskUrl,
    costUsd: inference.costUsd,
    latencyMs: inference.latencyMs,
    requestId: inference.requestId,
  };
}

/**
 * Resize to (width × height), grayscale, threshold to strict B/W. Returns
 * { buffer, meanGrayscale }. Mean is on the unthresholded grayscale buffer so the
 * inversion check matches what `onMockJobCreated` does at line ~8025.
 */
async function normalizeMaskBuffer(sharp, rawBuffer, targetWidth, targetHeight) {
  const grayscaled = await sharp(rawBuffer)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .grayscale()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < grayscaled.data.length; i++) sum += grayscaled.data[i];
  const meanGrayscale = grayscaled.data.length > 0 ? sum / grayscaled.data.length : 0;

  const thresholded = Buffer.alloc(grayscaled.data.length);
  for (let i = 0; i < grayscaled.data.length; i++) {
    thresholded[i] = grayscaled.data[i] >= 128 ? 255 : 0;
  }

  const pngBuffer = await sharp(thresholded, {
    raw: { width: grayscaled.info.width, height: grayscaled.info.height, channels: 1 },
  })
    .png()
    .toBuffer();

  return { buffer: pngBuffer, meanGrayscale };
}

function buildGenerateBlankMaskViaSam({ db, storage, functions, sharp }) {
  return async (data, context) => {
    await assertAdmin(db, functions, context && context.auth && context.auth.uid);

    const {
      blankId,
      view,
      renderTarget: renderTargetIn,
      variantId: variantIdIn,
      prompt: promptIn,
      seed: seedIn,
    } = data || {};
    if (!blankId || typeof blankId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankId is required");
    }
    if (view !== "front" && view !== "back") {
      throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
    }

    /**
     * `renderTarget` is optional for backward compat — when omitted, default to
     * the legacy flat path so existing UI callers keep working.
     */
    const renderTarget = renderTargetIn || `flat_${view}`;
    if (!VALID_RENDER_TARGETS.has(renderTarget)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `renderTarget must be one of ${[...VALID_RENDER_TARGETS].join(", ")}`
      );
    }
    const isModelTarget = renderTarget === "model_front" || renderTarget === "model_back";
    const variantId = variantIdIn && typeof variantIdIn === "string" ? variantIdIn.trim() : null;
    if (isModelTarget && !variantId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `variantId is required for renderTarget="${renderTarget}" (each color's model photo gets its own mask)`
      );
    }

    const falApiKey = getFalApiKey(functions);
    if (!falApiKey) {
      throw new functions.https.HttpsError("failed-precondition", "FAL_API_KEY is not configured");
    }

    const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
    if (!blankSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
    }
    const blank = blankSnap.data();

    const refImageUrl = pickRefImageUrl(blank, view, renderTarget, variantId);
    if (!refImageUrl) {
      const detail = isModelTarget
        ? `variant ${variantId} has no ${renderTarget === "model_front" ? "modelFront" : "modelBack"} image — upload one on the Identity tab first`
        : `Blank has no ${view} reference image — upload one (Identity tab) or add a variant photo first`;
      throw new functions.https.HttpsError("failed-precondition", detail);
    }

    const refImageResp = await fetch(refImageUrl);
    if (!refImageResp.ok) {
      throw new functions.https.HttpsError("internal", `Failed to fetch reference image (HTTP ${refImageResp.status})`);
    }
    const refImageBuffer = Buffer.from(await refImageResp.arrayBuffer());
    const refMeta = await sharp(refImageBuffer).metadata();
    if (!refMeta.width || !refMeta.height) {
      throw new functions.https.HttpsError("internal", "Reference image has no readable dimensions");
    }

    const prompt = typeof promptIn === "string" && promptIn.trim().length > 0
      ? promptIn.trim()
      : defaultPromptFor(renderTarget, view);
    const seed = Number.isFinite(Number(seedIn)) ? Number(seedIn) : Math.floor(Math.random() * 1e9);

    const endpoint = getSamEndpoint(functions);
    const samResult = await runSam(falApiKey, endpoint, refImageUrl, prompt, seed);
    const samMaskUrl = samResult.maskUrl;
    console.log(
      `[sam] cost=$${samResult.costUsd ?? "?"} latency=${samResult.latencyMs}ms request_id=${samResult.requestId || "?"} endpoint=${endpoint}`
    );

    const samResp = await fetch(samMaskUrl);
    if (!samResp.ok) {
      throw new functions.https.HttpsError("internal", `Failed to download SAM mask (HTTP ${samResp.status})`);
    }
    const samRawBuffer = Buffer.from(await samResp.arrayBuffer());

    const { buffer: normalizedBuffer, meanGrayscale } = await normalizeMaskBuffer(
      sharp,
      samRawBuffer,
      refMeta.width,
      refMeta.height
    );

    if (meanGrayscale < MEAN_MIN || meanGrayscale > MEAN_MAX) {
      throw new functions.https.HttpsError(
        "internal",
        `SAM returned a near-empty or inverted mask (mean=${Math.round(meanGrayscale)}). Try a different prompt or refresh.`
      );
    }

    const timestamp = Date.now();
    const { storageDir } = maskKeyFor(blankId, view, renderTarget, variantId);
    const previewStoragePath = `${storageDir}/_ai_preview_${timestamp}.png`;
    const bucket = storage.bucket();
    const fileRef = bucket.file(previewStoragePath);
    await fileRef.save(normalizedBuffer, {
      contentType: "image/png",
      metadata: { contentType: "image/png" },
      resumable: false,
    });

    /**
     * Make the preview readable via a token download URL so the client can display it
     * in the existing mask preview slot without needing extra Storage rules changes.
     * `mask.png` (canonical) uses the same scheme via the existing upload flow.
     */
    const downloadToken = `${timestamp}_${Math.floor(Math.random() * 1e6).toString(16)}`;
    await fileRef.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(previewStoragePath)}?alt=media&token=${downloadToken}`;

    return {
      previewMaskUrl: downloadUrl,
      previewMaskStoragePath: previewStoragePath,
      width: refMeta.width,
      height: refMeta.height,
      bytes: normalizedBuffer.length,
      prompt,
      seed,
      meanGrayscale: Math.round(meanGrayscale),
      endpoint,
      /**
       * Phase A cost telemetry. Client can show "$0.005, 4.2s" inline next to
       * the preview, and these get persisted onto rp_blank_masks at commit-time
       * so the dashboard cost-meter widget can sum spend by blank.
       */
      falCostUsd: samResult.costUsd,
      falLatencyMs: samResult.latencyMs,
      falRequestId: samResult.requestId,
      /** Echoed so the client can pass them straight back to commit without re-deriving. */
      renderTarget,
      variantId,
    };
  };
}

function buildCommitBlankMaskFromPreview({ db, admin, storage, functions, sharp }) {
  return async (data, context) => {
    await assertAdmin(db, functions, context && context.auth && context.auth.uid);
    const uid = context.auth.uid;

    const {
      blankId,
      view,
      renderTarget: renderTargetIn,
      variantId: variantIdIn,
      previewMaskStoragePath,
      prompt,
      seed,
      /**
       * Phase A: client echoes the cost telemetry from the generate response.
       * These are optional — older clients that haven't been updated still
       * commit successfully, the doc just lacks the cost fields (the dashboard
       * widget reads `null` as "unknown" and groups separately).
       */
      falCostUsd: falCostUsdIn,
      falLatencyMs: falLatencyMsIn,
      falRequestId: falRequestIdIn,
      falEndpoint: falEndpointIn,
    } = data || {};
    if (!blankId || typeof blankId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankId is required");
    }
    if (view !== "front" && view !== "back") {
      throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
    }
    if (!previewMaskStoragePath || typeof previewMaskStoragePath !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "previewMaskStoragePath is required");
    }
    const renderTarget = renderTargetIn || `flat_${view}`;
    if (!VALID_RENDER_TARGETS.has(renderTarget)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `renderTarget must be one of ${[...VALID_RENDER_TARGETS].join(", ")}`
      );
    }
    const isModelTarget = renderTarget === "model_front" || renderTarget === "model_back";
    const variantId = variantIdIn && typeof variantIdIn === "string" ? variantIdIn.trim() : null;
    if (isModelTarget && !variantId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `variantId is required for renderTarget="${renderTarget}"`
      );
    }

    /**
     * Build the canonical paths + doc id once via the same helper used by the
     * generator so the preview path guard, canonical save location, and Firestore
     * doc id all stay in lockstep.
     */
    const { docId: maskDocId, storageDir } = maskKeyFor(blankId, view, renderTarget, variantId);
    const expectedPreviewPrefix = `${storageDir}/_ai_preview_`;
    if (!previewMaskStoragePath.startsWith(expectedPreviewPrefix)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `previewMaskStoragePath does not match expected directory for this (blankId, view, renderTarget, variantId)`
      );
    }

    const bucket = storage.bucket();
    const previewFile = bucket.file(previewMaskStoragePath);
    const [exists] = await previewFile.exists();
    if (!exists) {
      throw new functions.https.HttpsError("not-found", "Preview file not found in Storage");
    }

    const canonicalStoragePath = `${storageDir}/mask.png`;
    const canonicalFile = bucket.file(canonicalStoragePath);

    const [bytes] = await previewFile.download();
    const meta = await sharp(bytes).metadata();
    const downloadToken = `${Date.now()}_${Math.floor(Math.random() * 1e6).toString(16)}`;
    await canonicalFile.save(bytes, {
      contentType: "image/png",
      metadata: {
        contentType: "image/png",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(canonicalStoragePath)}?alt=media&token=${downloadToken}`;

    const maskDocRef = db.collection("rp_blank_masks").doc(maskDocId);
    const existingSnap = await maskDocRef.get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docPayload = {
      id: maskDocId,
      blankId,
      view,
      renderTarget,
      variantId: isModelTarget ? variantId : null,
      mask: {
        storagePath: canonicalStoragePath,
        downloadUrl,
        width: meta.width || null,
        height: meta.height || null,
        contentType: "image/png",
        bytes: bytes.length,
      },
      mode: "inpaint",
      source: "ai_sam",
      aiPrompt: typeof prompt === "string" ? prompt : null,
      aiSeed: Number.isFinite(Number(seed)) ? Number(seed) : null,
      /**
       * Phase A telemetry — costs feed the dashboard widget. Fields are null
       * when the client didn't send them (older callers), which the widget
       * surfaces as "unknown cost" rather than $0 (a real $0 would be
       * misleading for spend totals).
       */
      falCostUsd: Number.isFinite(Number(falCostUsdIn)) ? Number(falCostUsdIn) : null,
      falLatencyMs: Number.isFinite(Number(falLatencyMsIn)) ? Number(falLatencyMsIn) : null,
      falRequestId: typeof falRequestIdIn === "string" ? falRequestIdIn : null,
      falEndpoint: typeof falEndpointIn === "string" ? falEndpointIn : DEFAULT_SAM_ENDPOINT,
      lockedAt: now,
      updatedAt: now,
      updatedByUid: uid,
    };
    if (!existingSnap.exists) {
      docPayload.createdAt = now;
      docPayload.createdByUid = uid;
    }
    await maskDocRef.set(docPayload, { merge: true });

    previewFile.delete().catch((e) => {
      console.warn("[commitBlankMaskFromPreview] preview cleanup failed:", e && e.message);
    });

    return {
      ok: true,
      maskDocId,
      mask: docPayload.mask,
      source: "ai_sam",
      aiPrompt: docPayload.aiPrompt,
      aiSeed: docPayload.aiSeed,
      renderTarget,
      variantId: docPayload.variantId,
    };
  };
}

module.exports = {
  buildGenerateBlankMaskViaSam,
  buildCommitBlankMaskFromPreview,
  pickRefImageUrl,
  maskKeyFor,
  defaultPromptFor,
  VALID_RENDER_TARGETS,
  DEFAULT_SAM_ENDPOINT,
  DEFAULT_PROMPT_FRONT,
  DEFAULT_PROMPT_BACK,
  DEFAULT_PROMPT_MODEL_FRONT,
  DEFAULT_PROMPT_MODEL_BACK,
};
