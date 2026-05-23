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

const DEFAULT_SAM_ENDPOINT = "fal-ai/evf-sam";
const DEFAULT_PROMPT_FRONT = "chest panel inside seams";
const DEFAULT_PROMPT_BACK = "back torso panel inside seams";
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

function pickRefImageUrl(blank, view) {
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
 * Submit to fal.ai queue, poll until COMPLETED, return the first result image URL.
 * Throws on failure / timeout with a user-readable message.
 */
async function runSam(falApiKey, endpoint, imageUrl, prompt, seed) {
  const url = `${FAL_QUEUE_BASE}/${endpoint}`;

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

  const submitResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${falApiKey}` },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(`fal.ai submit failed (${submitResp.status}): ${errText}`);
  }
  const submitJson = await submitResp.json();
  const requestId = submitJson.request_id || submitJson.id || null;

  let resultJson = null;
  if (submitJson.status === "COMPLETED") {
    resultJson = submitJson;
  } else if (requestId) {
    const statusUrl = submitJson.status_url || `${url}/requests/${requestId}/status`;
    const responseUrl = submitJson.response_url || `${url}/requests/${requestId}`;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const statusResp = await fetch(statusUrl, {
        headers: { Authorization: `Key ${falApiKey}` },
      });
      if (!statusResp.ok) continue;
      const statusJson = await statusResp.json();
      if (statusJson.status === "COMPLETED") {
        const finalResp = await fetch(responseUrl, {
          headers: { Authorization: `Key ${falApiKey}` },
        });
        if (!finalResp.ok) {
          throw new Error(`fal.ai result fetch failed (${finalResp.status})`);
        }
        resultJson = await finalResp.json();
        break;
      }
      if (statusJson.status === "FAILED") {
        throw new Error(`fal.ai job failed: ${statusJson.error || "unknown error"}`);
      }
    }
  }

  if (!resultJson) {
    throw new Error("fal.ai job did not complete within timeout");
  }

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
  return maskUrl;
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

    const { blankId, view, prompt: promptIn, seed: seedIn } = data || {};
    if (!blankId || typeof blankId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankId is required");
    }
    if (view !== "front" && view !== "back") {
      throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
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

    const refImageUrl = pickRefImageUrl(blank, view);
    if (!refImageUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Blank has no ${view} reference image — upload one (Identity tab) or add a variant photo first`
      );
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
      : view === "front"
        ? DEFAULT_PROMPT_FRONT
        : DEFAULT_PROMPT_BACK;
    const seed = Number.isFinite(Number(seedIn)) ? Number(seedIn) : Math.floor(Math.random() * 1e9);

    const endpoint = getSamEndpoint(functions);
    const samMaskUrl = await runSam(falApiKey, endpoint, refImageUrl, prompt, seed);

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
    const previewStoragePath = `rp/blank_masks/${blankId}/${view}/_ai_preview_${timestamp}.png`;
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
    };
  };
}

function buildCommitBlankMaskFromPreview({ db, admin, storage, functions, sharp }) {
  return async (data, context) => {
    await assertAdmin(db, functions, context && context.auth && context.auth.uid);
    const uid = context.auth.uid;

    const { blankId, view, previewMaskStoragePath, prompt, seed } = data || {};
    if (!blankId || typeof blankId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "blankId is required");
    }
    if (view !== "front" && view !== "back") {
      throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
    }
    if (!previewMaskStoragePath || typeof previewMaskStoragePath !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "previewMaskStoragePath is required");
    }
    /**
     * Guard against a caller passing an unrelated Storage path. The preview must live under
     * the blank+view's mask directory and use the `_ai_preview_` filename prefix produced by
     * `generateBlankMaskViaSam`.
     */
    const expectedPrefix = `rp/blank_masks/${blankId}/${view}/_ai_preview_`;
    if (!previewMaskStoragePath.startsWith(expectedPrefix)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "previewMaskStoragePath does not match this blank/view"
      );
    }

    const bucket = storage.bucket();
    const previewFile = bucket.file(previewMaskStoragePath);
    const [exists] = await previewFile.exists();
    if (!exists) {
      throw new functions.https.HttpsError("not-found", "Preview file not found in Storage");
    }

    const canonicalStoragePath = `rp/blank_masks/${blankId}/${view}/mask.png`;
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

    const maskDocId = `${blankId}_${view}`;
    const maskDocRef = db.collection("rp_blank_masks").doc(maskDocId);
    const existingSnap = await maskDocRef.get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docPayload = {
      id: maskDocId,
      blankId,
      view,
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
    };
  };
}

module.exports = {
  buildGenerateBlankMaskViaSam,
  buildCommitBlankMaskFromPreview,
  DEFAULT_SAM_ENDPOINT,
  DEFAULT_PROMPT_FRONT,
  DEFAULT_PROMPT_BACK,
};
