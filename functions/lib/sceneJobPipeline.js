"use strict";

/**
 * Phase C — AI scene generation pipeline (Flux Kontext).
 *
 * Three pieces:
 *   1. buildEnqueueSceneJob: callable that creates ONE rp_scene_jobs doc and
 *      returns its id. Single-template generation.
 *   2. buildEnqueueSceneJobBatch: callable that creates N docs (one per
 *      template) sharing a `sceneSetId`. For the "4-shot PDP" button.
 *   3. buildOnSceneJobCreated: Firestore trigger that drains rp_scene_jobs.
 *      Calls Kontext via runFalInference, saves PNG, stamps cost on doc,
 *      writes result to variant.sceneRenders[templateId].
 *
 * Design choices:
 *   - New collection `rp_scene_jobs` rather than extending
 *     rp_blank_preview_jobs. Scene jobs need none of the Stage A inputs
 *     (placement, mask, design colors); muddying preview jobs with optional
 *     "is this a scene job?" flags would be worse than a clean schema.
 *   - Source image is passed as a URL — the trigger fetches it. This means
 *     the source must be publicly readable (storage URL with token) which
 *     all Rally renders are.
 *   - Result is written to `variant.sceneRenders[templateId]` so the
 *     product page can read from a stable, indexable shape.
 *   - Cost telemetry stamped on the job doc top-level (falCostUsd, etc.)
 *     so the dashboard widget aggregates it alongside preview-job cost
 *     without descending into nested fields.
 */

const { runFalInference } = require("./falInference");
const { getSceneTemplate, getDefault4ShotTemplateIds } = require("./sceneTemplates");
const { createBatchAtomically, incrementBatchCounters } = require("./batchHelpers");

const KONTEXT_ENDPOINT = "fal-ai/flux-pro/kontext";
/** 60 attempts × 1500ms = 90s. Kontext usually completes in 15-30s. */
const KONTEXT_MAX_POLL_ATTEMPTS = 60;
const KONTEXT_POLL_INTERVAL_MS = 1500;

const VALID_SOURCE_SLOTS = new Set([
  "flat_front_designed",
  "flat_back_designed",
  "model_front_designed",
  "model_back_designed",
  "flat_blended",
  /** Custom: allow operator to pass any URL via `sourceUrlOverride`. */
  "custom",
]);

async function assertAdmin(db, functions, uid) {
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
  const snap = await db.collection("admins").doc(uid).get();
  if (!snap.exists) throw new functions.https.HttpsError("permission-denied", "Admins only");
}

function getFalApiKey(functions) {
  try {
    const cfg = functions.config && functions.config();
    const keyFromConfig = cfg && cfg.fal && cfg.fal.key;
    return process.env.FAL_API_KEY || keyFromConfig;
  } catch (e) {
    return process.env.FAL_API_KEY;
  }
}

/**
 * Resolve the source image URL for a given (product, variant, slot) tuple.
 * Reads variant.flatRenders[slot].url. Returns null if not present — the
 * caller throws a clear error in that case rather than letting Kontext
 * fail on a missing URL.
 */
async function resolveSourceUrl(db, { productId, variantId, sourceSlot, sourceUrlOverride }) {
  if (sourceSlot === "custom") {
    if (!sourceUrlOverride || typeof sourceUrlOverride !== "string") {
      return null;
    }
    return sourceUrlOverride;
  }
  if (!productId || !variantId) return null;
  const variantRef = db
    .collection("rp_products")
    .doc(productId)
    .collection("variants")
    .doc(variantId);
  const snap = await variantRef.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const flatRenders = data.flatRenders || {};
  const slot = flatRenders[sourceSlot];
  if (slot && typeof slot.url === "string" && slot.url.length > 0) {
    return slot.url;
  }
  return null;
}

function validateSceneJobInput(functions, data) {
  const {
    productId,
    variantId,
    sourceSlot: sourceSlotIn,
    sourceUrlOverride,
    sceneTemplateId,
  } = data || {};
  if (!productId || typeof productId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "productId is required");
  }
  if (!variantId || typeof variantId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "variantId is required");
  }
  const sourceSlot = sourceSlotIn || "model_front_designed";
  if (!VALID_SOURCE_SLOTS.has(sourceSlot)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `sourceSlot must be one of: ${[...VALID_SOURCE_SLOTS].join(", ")}`
    );
  }
  if (sourceSlot === "custom" && (!sourceUrlOverride || typeof sourceUrlOverride !== "string")) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "sourceUrlOverride is required when sourceSlot='custom'"
    );
  }
  if (!sceneTemplateId || typeof sceneTemplateId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "sceneTemplateId is required");
  }
  // Validate the template id against the registry — fast-fail before creating the job doc.
  try {
    getSceneTemplate(sceneTemplateId);
  } catch (e) {
    throw new functions.https.HttpsError("invalid-argument", e.message);
  }
  return {
    productId,
    variantId,
    sourceSlot,
    sourceUrlOverride: sourceSlot === "custom" ? sourceUrlOverride : null,
    sceneTemplateId,
  };
}

/**
 * Callable: enqueue ONE scene job. Returns its job id so the UI can subscribe.
 */
function buildEnqueueSceneJob({ db, functions, admin }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);
    const input = validateSceneJobInput(functions, data);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const jobData = {
      productId: input.productId,
      variantId: input.variantId,
      sourceSlot: input.sourceSlot,
      sourceUrlOverride: input.sourceUrlOverride,
      sceneTemplateId: input.sceneTemplateId,
      status: "queued",
      error: null,
      result: null,
      createdAt: now,
      createdByUid: uid,
      updatedAt: now,
    };
    const ref = await db.collection("rp_scene_jobs").add(jobData);
    return { jobId: ref.id, status: "queued" };
  };
}

/**
 * Callable: fan out N scene jobs in one call. Shares a sceneSetId so the
 * UI can subscribe to the set with a single query. Defaults to the
 * curated 4-shot PDP template list when sceneTemplateIds is omitted.
 *
 * Capped at 6 templates per fan-out — each scene is $0.04 and ~20s, so 6 is
 * the upper limit on what an operator is going to wait for / pay for in
 * one click.
 */
function buildEnqueueSceneJobBatch({ db, functions, admin }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    await assertAdmin(db, functions, uid);

    const {
      productId,
      variantId,
      sourceSlot: sourceSlotIn,
      sourceUrlOverride,
      sceneTemplateIds: idsIn,
    } = data || {};

    if (!productId || typeof productId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "productId is required");
    }
    if (!variantId || typeof variantId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "variantId is required");
    }
    const sourceSlot = sourceSlotIn || "model_front_designed";
    if (!VALID_SOURCE_SLOTS.has(sourceSlot)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `sourceSlot must be one of: ${[...VALID_SOURCE_SLOTS].join(", ")}`
      );
    }

    let templateIds = Array.isArray(idsIn) && idsIn.length > 0 ? idsIn : getDefault4ShotTemplateIds();
    if (templateIds.length < 1) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "sceneTemplateIds must contain at least one template id"
      );
    }
    if (templateIds.length > 6) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "sceneTemplateIds capped at 6 per fan-out — each scene costs $0.04 + ~20s"
      );
    }
    // Validate every template id BEFORE creating any docs.
    templateIds.forEach((id) => {
      if (typeof id !== "string") {
        throw new functions.https.HttpsError("invalid-argument", `Invalid sceneTemplateId: ${JSON.stringify(id)}`);
      }
      try {
        getSceneTemplate(id);
      } catch (e) {
        throw new functions.https.HttpsError("invalid-argument", e.message);
      }
    });
    const uniqueIds = [...new Set(templateIds)];

    /**
     * Phase E: atomic fan-out. The parent batch doc + every child job doc
     * land in a single Firestore commit, so a half-fan-out (some jobs
     * created, batch never written) is impossible — either every doc is in
     * Firestore or none are. Without atomic fan-out, a callable timeout
     * after writing N-1 jobs would leak partial work.
     */
    const sceneSetId = `set_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const jobs = uniqueIds.map((sceneTemplateId) => ({
      collectionPath: "rp_scene_jobs",
      data: {
        productId,
        variantId,
        sourceSlot,
        sourceUrlOverride: sourceSlot === "custom" ? sourceUrlOverride : null,
        sceneTemplateId,
        sceneSetId,
        status: "queued",
        error: null,
        result: null,
        createdAt: now,
        createdByUid: uid,
        updatedAt: now,
      },
    }));

    const { batchId, jobRefs } = await createBatchAtomically({
      db,
      admin,
      kind: "scene_set",
      createdByUid: uid,
      metadata: {
        productId,
        variantId,
        sceneTemplateIds: uniqueIds,
        label: `${uniqueIds.length}-shot scene set`,
      },
      jobs,
    });

    /** Build the {templateId → jobId} map in input order so the UI can subscribe. */
    const jobIds = Object.fromEntries(
      uniqueIds.map((id, i) => [id, jobRefs[i].id])
    );

    return { sceneSetId, batchId, jobIds, templateCount: uniqueIds.length };
  };
}

/**
 * Trigger: drain rp_scene_jobs. For each queued job:
 *   1. Resolve the source image URL from variant.flatRenders[sourceSlot]
 *   2. Look up the template + prompt
 *   3. Call Kontext via runFalInference
 *   4. Download result, save to Storage at rp/scene_renders/{productId}/{variantId}/{templateId}.png
 *   5. Write to variant.sceneRenders[templateId] AND the job doc's result field
 *   6. Stamp falCostUsd/falLatencyMs/falEndpoint/falRequestId for the cost meter
 */
function buildOnSceneJobCreated({ db, storage, admin, functions, sharp }) {
  return async (snap, eventContext) => {
    const job = snap.data();
    const jobId = eventContext && eventContext.params ? eventContext.params.jobId : snap.id || "?";
    if (!job || job.status !== "queued") {
      console.log(`[onSceneJobCreated] Job ${jobId} not queued (status=${job && job.status}), skipping`);
      return;
    }
    const jobRef = db.collection("rp_scene_jobs").doc(jobId);
    const tick = () => admin.firestore.FieldValue.serverTimestamp();

    try {
      await jobRef.update({ status: "processing", updatedAt: tick() });

      const falApiKey = getFalApiKey(functions);
      if (!falApiKey) {
        throw new Error("FAL_API_KEY not configured");
      }
      const template = getSceneTemplate(job.sceneTemplateId);
      const sourceUrl = await resolveSourceUrl(db, {
        productId: job.productId,
        variantId: job.variantId,
        sourceSlot: job.sourceSlot,
        sourceUrlOverride: job.sourceUrlOverride,
      });
      if (!sourceUrl) {
        throw new Error(
          `Source image not found: variant ${job.variantId}.flatRenders[${job.sourceSlot}] is empty. ` +
            `Generate a ${job.sourceSlot} render first or pass sourceUrlOverride.`
        );
      }
      console.log(
        `[onSceneJobCreated] Job ${jobId}: template=${template.id} source=${sourceUrl.slice(0, 80)}...`
      );

      const inference = await runFalInference({
        endpoint: KONTEXT_ENDPOINT,
        payload: {
          /**
           * Kontext takes `image_url` (the source) + `prompt` (the edit
           * instruction). No mask, no strength — the model interprets
           * "preserve X, change Y" entirely from the prompt language.
           */
          image_url: sourceUrl,
          prompt: template.prompt,
        },
        falApiKey,
        maxPollAttempts: KONTEXT_MAX_POLL_ATTEMPTS,
        pollIntervalMs: KONTEXT_POLL_INTERVAL_MS,
        withLogs: true,
      });
      console.log(
        `[onSceneJobCreated] Job ${jobId}: cost=$${inference.costUsd ?? "?"} latency=${inference.latencyMs}ms request_id=${inference.requestId || "?"}`
      );

      /** Kontext result shape: { images: [{url}] } typically. */
      const resultImages =
        inference.result.images ||
        (inference.result.output && inference.result.output.images) ||
        (inference.result.image ? [inference.result.image] : []);
      if (!Array.isArray(resultImages) || resultImages.length === 0) {
        throw new Error(
          `Kontext returned no images. Response keys: ${JSON.stringify(Object.keys(inference.result))}`
        );
      }
      const resultUrl =
        typeof resultImages[0] === "string" ? resultImages[0] : resultImages[0].url;
      if (!resultUrl) throw new Error("Kontext result missing image URL");

      const dlResp = await fetch(resultUrl);
      if (!dlResp.ok) throw new Error(`Failed to download Kontext image (HTTP ${dlResp.status})`);
      const sceneBuffer = Buffer.from(await dlResp.arrayBuffer());
      const sceneMeta = await sharp(sceneBuffer).metadata();

      /**
       * Storage path: keyed on (productId, variantId, templateId) so re-running
       * the same template overwrites cleanly. No timestamp in the path —
       * we want predictable URLs that PDP cache layers can rely on.
       */
      const storagePath = `rp/scene_renders/${job.productId}/${job.variantId}/${job.sceneTemplateId}.png`;
      const downloadToken = `${Date.now()}_${Math.floor(Math.random() * 1e6).toString(16)}`;
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      await file.save(sceneBuffer, {
        contentType: "image/png",
        metadata: {
          contentType: "image/png",
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
        resumable: false,
      });
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
      console.log(`[onSceneJobCreated] Job ${jobId}: saved ${storagePath} (${sceneBuffer.length} bytes)`);

      const resultPayload = {
        url: downloadUrl,
        storagePath,
        width: sceneMeta.width || null,
        height: sceneMeta.height || null,
        bytes: sceneBuffer.length,
        sourceUrl,
        sourceSlot: job.sourceSlot,
        sceneTemplateId: job.sceneTemplateId,
        category: template.category,
        prompt: template.prompt,
        renderedAt: tick(),
      };

      /**
       * Best-effort write to variant.sceneRenders[templateId]. Failure here
       * doesn't fail the job — the scene PNG is still in Storage and the
       * job result field carries the URL, so the operator can manually
       * rebind if needed.
       */
      try {
        const variantRef = db
          .collection("rp_products")
          .doc(job.productId)
          .collection("variants")
          .doc(job.variantId);
        const variantSnap = await variantRef.get();
        if (variantSnap.exists) {
          const existing = (variantSnap.data() || {}).sceneRenders || {};
          await variantRef.update({
            sceneRenders: {
              ...existing,
              [job.sceneTemplateId]: {
                url: downloadUrl,
                storagePath,
                width: sceneMeta.width || null,
                height: sceneMeta.height || null,
                bytes: sceneBuffer.length,
                sceneTemplateId: job.sceneTemplateId,
                category: template.category,
                sourceSlot: job.sourceSlot,
                sourceUrl,
                jobId,
                updatedAt: tick(),
              },
            },
            updatedAt: tick(),
            updatedBy: "scene_render_trigger",
          });
          console.log(
            `[onSceneJobCreated] Job ${jobId}: wrote sceneRenders[${job.sceneTemplateId}] to variant ${job.variantId}`
          );
        } else {
          console.warn(
            `[onSceneJobCreated] Job ${jobId}: variant ${job.productId}/${job.variantId} not found, skipping write`
          );
        }
      } catch (writeErr) {
        console.error(
          `[onSceneJobCreated] Job ${jobId}: variant write failed:`,
          writeErr && writeErr.message ? writeErr.message : writeErr
        );
      }

      await jobRef.update({
        status: "completed",
        result: resultPayload,
        falCostUsd: inference.costUsd,
        falLatencyMs: inference.latencyMs,
        falEndpoint: inference.endpoint,
        falRequestId: inference.requestId,
        updatedAt: tick(),
      });
      console.log(`[onSceneJobCreated] Job ${jobId} completed`);
    } catch (err) {
      console.error(`[onSceneJobCreated] Job ${jobId} failed:`, err && err.message);
      await jobRef
        .update({
          status: "failed",
          error: err && err.message ? String(err.message) : "Unknown error",
          updatedAt: tick(),
        })
        .catch((updateErr) => {
          console.error(
            `[onSceneJobCreated] Failed to record error on ${jobId}:`,
            updateErr && updateErr.message
          );
        });
    }
  };
}

module.exports = {
  buildEnqueueSceneJob,
  buildEnqueueSceneJobBatch,
  buildOnSceneJobCreated,
  VALID_SOURCE_SLOTS,
  KONTEXT_ENDPOINT,
};
