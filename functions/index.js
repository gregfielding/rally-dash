"use strict";

/**
 * Cloud Functions for fal.ai LoRA training.
 *
 * IMPORTANT:
 * - Do NOT put the fal API key in this file.
 * - Configure it as an environment variable instead:
 *     firebase functions:config:set fal.key="YOUR_FAL_API_KEY"
 * - Then read via process.env.FAL_API_KEY at runtime.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { z } = require("zod");
const OpenAI = require("openai");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

const shopifySync = require("./shopifySync");
const shopifySmartCollections = require("./lib/shopifySmartCollections");
const { resolveBlankTemplates, stripUnresolvedTemplateArtifacts } = require("./lib/resolveBlankTemplates");
const merchandisingAtCreate = require("./lib/merchandisingAtCreate");
const runCreateProductFromDesignBlankCore = require("./lib/runCreateProductFromDesignBlankCore");
const { startInitialProductAssetBatch } = require("./lib/startInitialProductAssetBatch");
const { executeTeamProductVariantCreation } = require("./lib/executeTeamProductVariantCreation");
const { launchProductsFromDesign } = require("./lib/launchProductsFromDesign");
const { buildOnDesignCreated } = require("./lib/onDesignCreated");
const {
  bulkMarkProductsReviewed,
  bulkSyncProductsToShopify,
  bulkRetryProductAssets,
} = require("./lib/bulkProductOps");
const { LAUNCH_STATUS } = require("./lib/productLaunchStatus");
const { pipelineFailurePatch, pipelineClearErrorPatch, PIPELINE_STAGE } = require("./lib/pipelineReporting");
const { createRegisterGenerateProductFlatRenders } = require("./lib/productFlatRenderMvp");
const { createRegisterGenerateProductSceneRender } = require("./lib/productSceneRenderMvp");
const { normalizeColorsForFirestore } = require("./lib/standardPrintInks");
const variant8394Pipeline = require("./lib/variant8394Pipeline");
const { launchBatchLog } = require("./lib/productAssetBatchHelpers");
const {
  resolvePrintSidesForProductBuild,
  inferDefaultPrintSides,
  garmentCategoryDefaultPrintSides,
} = require("./lib/resolveDefaultPrintSides");

// Resolve a fal-ai model slug or URL into a full HTTPS URL.
function resolveFalUrl(modelOrUrl) {
  if (!modelOrUrl) return null;
  if (modelOrUrl.startsWith("http://") || modelOrUrl.startsWith("https://")) {
    return modelOrUrl;
  }
  // Treat as model slug, e.g. "fal-ai/flux-lora"
  // fal.ai uses queue.fal.run for inference endpoints
  return `https://queue.fal.run/${modelOrUrl}`;
}

// Resolve fal.ai API key from environment or functions config.
function getFalApiKey() {
  try {
    const cfg = functions.config && functions.config();
    const keyFromConfig = cfg && cfg.fal && cfg.fal.key;
    return process.env.FAL_API_KEY || keyFromConfig;
  } catch (e) {
    return process.env.FAL_API_KEY;
  }
}

/**
 * Recursively sanitize an object for Firestore: strip undefined (Firestore does not accept undefined).
 * - undefined → omitted (for object keys) or null (in arrays)
 * - Nested plain objects and arrays are processed recursively.
 * - Timestamps, FieldValues, and other non-plain objects are left as-is.
 */
function sanitizeForFirestore(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (value && typeof value.toDate === "function") return value; // Firestore Timestamp
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  // Leave non-plain objects (FieldValue, Date, etc.) unchanged
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const sanitized = sanitizeForFirestore(v);
    if (sanitized !== undefined) out[k] = sanitized;
  }
  return out;
}

const { resolvePromptWithGuardrails } = require("./lib/promptGuardrailsShared");
const {
  createCreateGenerationJob,
  estimateGenerationCost,
  BASELINE_NEGATIVE_PROMPT,
} = require("./lib/createGenerationJobCore");
const createGenerationJob = createCreateGenerationJob({ db, admin, sanitizeForFirestore });
const {
  buildGenerateBlankMaskViaSam,
  buildCommitBlankMaskFromPreview,
} = require("./lib/blankMaskGeneration");
const {
  buildPreviewBlankRender,
  buildOnBlankPreviewJobCreated,
  buildEnqueueVtonAbTest,
  runRealismPass,
  hexToColorName,
  buildLetterMaskFromDesignRgba,
} = require("./lib/blankPreviewRender");
const {
  buildEnqueueSceneJob,
  buildEnqueueSceneJobBatch,
  buildOnSceneJobCreated,
} = require("./lib/sceneJobPipeline");
const { buildOnJobBatchProgress } = require("./lib/batchProgressTriggers");
const {
  buildAddIdentityReferenceImage,
  buildRemoveIdentityReferenceImage,
  buildSetIdentityMode,
} = require("./lib/identityReferenceImages");
const { buildSaveModelPrintQuad } = require("./lib/modelPrintQuad");
const {
  buildEnqueueProductModelRealism,
  buildEnqueueProductModelRealismBatch,
} = require("./lib/enqueueProductModelRealism");

// Check if placeholder worker mode is enabled (default: true for safety)
function usePlaceholderWorker() {
  try {
    const cfg = functions.config && functions.config();
    // Firebase config uses underscores: rp.use_placeholder_worker
    // Config values come as strings: "true" or "false"
    const flagFromConfig = cfg && cfg.rp && (cfg.rp.use_placeholder_worker !== undefined ? cfg.rp.use_placeholder_worker : cfg.rp.usePlaceholderWorker);
    const envFlag = process.env.RP_USE_PLACEHOLDER_WORKER;
    // Default to true if not set (safe default)
    // Handle both string and boolean values
    if (flagFromConfig !== undefined) {
      if (flagFromConfig === false || flagFromConfig === "false") return false;
      if (flagFromConfig === true || flagFromConfig === "true") return true;
    }
    if (envFlag !== undefined) {
      if (envFlag === "false") return false;
      if (envFlag === "true") return true;
    }
    return true; // Default: use placeholder for safety
  } catch (e) {
    return true; // Default: use placeholder for safety
  }
}

// Internal helper used by both the callable and the scheduled runner.
async function internalCheckTrainingJob(jobId) {
  const jobRef = db.collection("rp_training_jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    console.warn("[internalCheckTrainingJob] Job not found:", jobId);
    return { status: "not_found" };
  }
  const job = jobSnap.data();

  if (job.status !== "running") {
    return { status: job.status || "unknown" };
  }

  const FAL_API_KEY = getFalApiKey();
  let done = false;
  let loraWeightsUrl =
    job.loraWeightsUrl || `https://example.com/mock/${jobId}.safetensors`;
  let falResponseMeta = job.falResponseMeta || {};

  if (!FAL_API_KEY || !job.falRequestId) {
    // Stubbed completion when no fal API is wired yet.
    console.warn(
      "[internalCheckTrainingJob] FAL_API_KEY or falRequestId missing; stubbing completion."
    );
    done = true;
  } else {
    try {
      // If your fal trainer returns a status URL, you can store it in
      // falResponseMeta.status_url at startTrainingJob time and reuse it here.
      const rawStatus =
        (job.falResponseMeta &&
          (job.falResponseMeta.status_url || job.falResponseMeta.statusUrl)) ||
        job.falTrainerEndpoint;
      const statusUrl = resolveFalUrl(rawStatus);

      if (!statusUrl) {
        console.warn(
          "[internalCheckTrainingJob] No status endpoint found; stubbing completion."
        );
        done = true;
      } else {
        const resp = await fetch(statusUrl, {
          method: "GET",
          headers: {
            Authorization: `Key ${FAL_API_KEY}`,
          },
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error("[internalCheckTrainingJob] fal status error:", text);
          // If status lookup fails, keep job as running and try again later.
          return { status: "running" };
        }

        const json = await resp.json();
        const remoteStatus = json.status || json.state;
        const progress =
          json.progress !== undefined
            ? json.progress
            : json.percent_complete !== undefined
            ? json.percent_complete
            : undefined;

        // Persist latest status/progress snapshot for UI/debugging.
        const updateData = {
          falResponseMeta: json,
        };
        if (progress !== undefined) {
          updateData.progress = progress;
        }
        await jobRef.update(updateData);

        if (remoteStatus === "queued" || remoteStatus === "running") {
          return { status: "running", progress };
        }

        if (remoteStatus === "failed" || remoteStatus === "error") {
          await jobRef.update({
            status: "failed",
            error: json.error || json.message || "Training failed",
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return { status: "failed" };
        }

        if (
          remoteStatus === "completed" ||
          remoteStatus === "succeeded" ||
          remoteStatus === "done"
        ) {
          done = true;
          loraWeightsUrl =
            json.lora_weights_url ||
            json.weights_url ||
            json.result_url ||
            loraWeightsUrl;
          falResponseMeta = json;
        } else {
          // Unknown status, treat as still running.
          return { status: "running" };
        }
      }
    } catch (err) {
      console.error(
        "[internalCheckTrainingJob] Error calling fal status endpoint:",
        err
      );
      // Leave as running so we can try again later.
      return { status: "running" };
    }
  }

  if (!done) {
    return { status: "running" };
  }

  // Mark job as completed and store outputs
  await jobRef.update({
    status: "completed",
    loraWeightsUrl,
    falResponseMeta,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Create LoRA artifact linked to this training job and identity
  let artifactKind = "face";
  try {
    if (job.datasetId) {
      const dsSnap = await db.collection("rp_datasets").doc(job.datasetId).get();
      if (dsSnap.exists) {
        const ds = dsSnap.data() || {};
        if (ds.type === "upper_body" || ds.type === "full_body" || ds.type === "mixed") {
          artifactKind = "body";
        }
      }
    }
  } catch (e) {
    console.warn("[internalCheckTrainingJob] Failed to infer artifactKind from dataset:", e);
  }

  const artifactRef = await db.collection("rp_lora_artifacts").add({
    identityId: job.identityId,
    trainingJobId: jobRef.id,
    provider: "fal",
    weightsUrl: loraWeightsUrl,
    triggerPhrase: job.triggerPhrase,
    status: "active",
    name: job.name || `${job.identityId} LoRA v1`,
    trainerEndpoint: job.trainerEndpoint,
    datasetId: job.datasetId,
    recommendedScale: 0.65,
    recommendedScaleMin: 0.55,
    recommendedScaleMax: 0.85,
    defaultScale: 0.65,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    artifactKind,
  });

  // Update RPIdentity with active artifact + TRAINED status
  const identityRef = db.collection("rp_identities").doc(job.identityId);
  await identityRef.set(
    {
      defaultTriggerPhrase: job.triggerPhrase,
      activeLoraArtifactId: artifactRef.id,
      status: "trained",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    status: "completed",
    loraWeightsUrl,
    loraArtifactId: artifactRef.id,
  };
}

/**
 * startTrainingJob
 *
 * Callable function invoked by the app once a rp_training_jobs/{jobId}
 * document has been created with status === "queued".
 *
 * Responsibilities:
 * - Load the training job + referenced dataset
 * - Build a payload for fal.ai trainer
 * - Call the trainer endpoint (or stub in dev)
 * - Update the job with:
 *   - status = "running"
 *   - falRequestId
 *   - falRequestPayload (sanitized)
 *   - falResponseMeta
 */
exports.startTrainingJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication is required."
    );
  }

  const { jobId } = data || {};
  if (!jobId || typeof jobId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "jobId (string) is required."
    );
  }

  const jobRef = db.collection("rp_training_jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Training job not found.");
  }

  const job = jobSnap.data();
  if (job.status !== "queued") {
    return { status: job.status, message: "Job is not in queued state." };
  }

  // Load referenced dataset (we expect a prepared zip URL or equivalent)
  const datasetRef = db.collection("rp_datasets").doc(job.datasetId);
  const datasetSnap = await datasetRef.get();
  if (!datasetSnap.exists) {
    throw new functions.https.HttpsError("failed-precondition", "Dataset not found.");
  }
  const dataset = datasetSnap.data();

  // -------------------------------------------------------------------
  // Build real-ish fal payload
  //
  // Each trainer has its own input schema, but most LoRA trainers expect:
  // - images (zip or list of URLs)
  // - trigger_phrase
  // - steps
  // - learning_rate
  // - optional captioning / rank
  //
  // Here we standardize on a generic shape that you can adapt to the
  // exact fal trainer you end up using.
  // -------------------------------------------------------------------

  const imagesZipUrl = dataset.lastZipSignedUrl || dataset.lastZipStoragePath || null;

  // Build payload, filtering out undefined values
  const payload = {
    // primary training data
    images: imagesZipUrl ? [{ type: "zip", url: imagesZipUrl }] : [],
    trigger_phrase: job.triggerPhrase,
    steps: job.steps,
    learning_rate: job.learningRate,
    captioning: job.captioningMode || "none",

    // metadata for reproducibility / debugging on the fal side
    identity_id: job.identityId,
    dataset_id: job.datasetId,
  };

  // Only include seed if it's defined
  if (job.seed !== undefined && job.seed !== null) {
    payload.seed = job.seed;
  }

  const FAL_API_KEY = getFalApiKey();
  const trainerEndpoint = job.trainerEndpoint;

  let falRequestId = `local-${Date.now()}`;
  let falResponseMeta = { stubbed: true };

  if (!trainerEndpoint) {
    console.warn(
      "[startTrainingJob] trainerEndpoint missing on job; marking as running without remote call."
    );
  } else if (!FAL_API_KEY) {
    console.warn(
      "[startTrainingJob] FAL_API_KEY not set; skipping real API call and stubbing falRequestId."
    );
  } else {
    // Example real call – adjust URL and payload shape to match the exact
    // fal trainer you are using (flux-lora portrait trainer, etc).
    try {
      const url = resolveFalUrl(trainerEndpoint);

      // -----------------------------------------------------------------
      // Debug logging: fal training endpoint + payload shape.
      // This is intentionally concise (no full prompts or secrets).
      // -----------------------------------------------------------------
      functions.logger.info("[startTrainingJob] Calling fal trainer", {
        endpoint: url,
        trainerEndpoint,
        imagesCount: payload.images.length,
        hasImagesZip: !!imagesZipUrl,
        steps: payload.steps,
        learningRate: payload.learning_rate,
        seed: payload.seed,
        captioning: payload.captioning,
        identityId: job.identityId,
        datasetId: job.datasetId,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${FAL_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("[startTrainingJob] fal trainer error:", text);
        throw new functions.https.HttpsError(
          "internal",
          `fal trainer error: ${response.statusText}`
        );
      }

      const json = await response.json();
      falRequestId = json.request_id || json.id || falRequestId;
      falResponseMeta = json;
    } catch (err) {
      console.error("[startTrainingJob] Error calling fal trainer:", err);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to start training job with fal."
      );
    }
  }

  await jobRef.update({
    status: "running",
    falRequestId,
    falTrainerEndpoint: trainerEndpoint,
    falRequestPayload: payload,
    falResponseMeta,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { status: "running", falRequestId };
});

/**
 * Create a dataset ZIP for a given rp_datasets/{datasetId}.
 * This is a minimal implementation that writes a placeholder file to
 * Cloud Storage and records the storage path + signed URL on the dataset.
 * In a full implementation you would stream real images into a zip.
 */
exports.createDatasetZip = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }

  const { datasetId } = data || {};
  if (!datasetId || typeof datasetId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "datasetId is required"
    );
  }

  const datasetRef = db.collection("rp_datasets").doc(datasetId);
  const datasetSnap = await datasetRef.get();
  if (!datasetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Dataset not found");
  }

  const dataset = datasetSnap.data() || {};
  const identityId = dataset.identityId || "unknown";
  const zipPath = `training_zips/${identityId}/${datasetId}-${Date.now()}.zip`;

  const bucket = storage.bucket();
  const file = bucket.file(zipPath);

  // Placeholder zip content; replace with real zip generation later.
  await file.save("Placeholder dataset zip. TODO: implement real zipping.");

  // Make the file publicly readable and get download URL
  await file.makePublic();
  const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${zipPath}`;

  const contentHash = crypto
    .createHash("sha1")
    .update(`${datasetId}:${Date.now()}`)
    .digest("hex");

  await datasetRef.update({
    lastZipStoragePath: zipPath,
    lastZipSignedUrl: downloadUrl, // Store public URL instead of signed URL
    lastZipCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    contentHash,
  });

  return {
    storagePath: zipPath,
    signedUrl: downloadUrl, // Return public URL
    contentHash,
  };
});

/**
 * Save a single generation image into the per-identity reference library and
 * create a corresponding referenceImages doc + mark the generation as mirrored.
 */
exports.saveGenerationImageToReference = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
      );
    }

    const { identityId, genId, imageIndex } = data || {};
    if (
      !identityId ||
      !genId ||
      typeof imageIndex !== "number" ||
      imageIndex < 0
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "identityId, genId and non-negative imageIndex are required"
      );
    }

    const genRef = db.collection("rp_generations").doc(genId);
    const genSnap = await genRef.get();
    if (!genSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Generation not found");
    }
    const gen = genSnap.data() || {};
    const urls = gen.resultImageUrls || [];
    if (!Array.isArray(urls) || imageIndex >= urls.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "imageIndex out of range for this generation"
      );
    }

    const srcUrl = urls[imageIndex];
    const destPath = `identities/${identityId}/reference/${genId}_${imageIndex}.jpg`;

    const bucket = storage.bucket();
    const file = bucket.file(destPath);

    const resp = await fetch(srcUrl);
    if (!resp.ok) {
      const text = await resp.text();
      console.error(
        "[saveGenerationImageToReference] Failed to fetch source image:",
        text
      );
      throw new functions.https.HttpsError(
        "internal",
        "Failed to fetch source image for reference copy"
      );
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = await resp.buffer();
    await file.save(buffer, { contentType });

    const [downloadUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Create or reuse the existing referenceImages collection.
    const refDoc = await db.collection("referenceImages").add({
      category: "other",
      tags: [identityId, "fal_inference"],
      gcsPath: destPath,
      source: "ai_generated",
      safeToUse: false,
      notes: `From generation ${genId} [${imageIndex}]`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: context.auth.uid,
    });

    await genRef.set(
      {
        mirroredStoragePaths: admin.firestore.FieldValue.arrayUnion(destPath),
        savedToReferenceLibrary: true,
      },
      { merge: true }
    );

    return {
      ok: true,
      storagePath: destPath,
      downloadUrl,
      referenceImageId: refDoc.id,
    };
  }
);

/**
 * Copy an existing dataset image to a new dataset.
 * Handles copying both from rp_dataset_images and legacy identity images.
 */
exports.copyDatasetImage = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
      );
    }

    const { sourceImageId, sourceStoragePath, sourceDownloadUrl, targetDatasetId, targetIdentityId, kind } = data || {};
    if (!targetDatasetId || !targetIdentityId || !kind) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "targetDatasetId, targetIdentityId, and kind are required"
      );
    }

    if (!sourceStoragePath && !sourceDownloadUrl) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Either sourceStoragePath or sourceDownloadUrl is required"
      );
    }

    const bucket = storage.bucket();
    let sourceFile;
    let blob;
    let contentType = "image/jpeg"; // Default

    try {
      if (sourceStoragePath) {
        // Use Storage path directly
        console.log("[copyDatasetImage] Using Storage path:", sourceStoragePath);
        sourceFile = bucket.file(sourceStoragePath);
        const [exists] = await sourceFile.exists();
        if (!exists) {
          throw new functions.https.HttpsError("not-found", "Source file not found in Storage");
        }
        [blob] = await sourceFile.download();
        // Get content type from source file
        const [metadata] = await sourceFile.getMetadata();
        contentType = metadata.contentType || "image/jpeg";
        console.log("[copyDatasetImage] Downloaded from Storage, contentType:", contentType);
      } else if (sourceDownloadUrl) {
        // Download from URL (for legacy images)
        console.log("[copyDatasetImage] Fetching from URL:", sourceDownloadUrl);
        const resp = await fetch(sourceDownloadUrl);
        if (!resp.ok) {
          throw new Error(`Failed to fetch: ${resp.statusText} (${resp.status})`);
        }
        blob = Buffer.from(await resp.arrayBuffer());
        contentType = resp.headers.get("content-type") || "image/jpeg";
        console.log("[copyDatasetImage] Fetched from URL, contentType:", contentType);
      } else {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Either sourceStoragePath or sourceDownloadUrl is required"
        );
      }

      // Upload to new location
      const safeName = sourceStoragePath 
        ? sourceStoragePath.split("/").pop() 
        : `imported-${Date.now()}.jpg`;
      const fileName = safeName || `imported-${Date.now()}.jpg`;
      const destPath = `datasets/${targetDatasetId}/${Date.now()}-${fileName}`;
      const destFile = bucket.file(destPath);

      console.log("[copyDatasetImage] Saving to:", destPath);
      await destFile.save(blob, { contentType });
      console.log("[copyDatasetImage] File saved successfully");

      // Make the file publicly readable and get download URL
      await destFile.makePublic();
      const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${destPath}`;
      console.log("[copyDatasetImage] Generated download URL:", downloadUrl);

      // Create new rp_dataset_images doc
      const imageDoc = await db.collection("rp_dataset_images").add({
        datasetId: targetDatasetId,
        identityId: targetIdentityId,
        storagePath: destPath,
        downloadUrl,
        kind,
        source: "imported",
        isApproved: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("[copyDatasetImage] Created Firestore doc:", imageDoc.id);

      return {
        ok: true,
        imageId: imageDoc.id,
        storagePath: destPath,
        downloadUrl,
      };
    } catch (err) {
      console.error("[copyDatasetImage] Error:", err);
      if (err instanceof functions.https.HttpsError) {
        throw err;
      }
      throw new functions.https.HttpsError(
        "internal",
        `Failed to copy image: ${err.message || "Unknown error"}`
      );
    }
  }
);

/**
 * Copy a generation image into an rp_dataset_images entry and back it with
 * a datasets/{datasetId}/... Storage object.
 */
exports.addGenerationImageToDataset = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
      );
    }

    const { identityId, genId, imageIndex, datasetId } = data || {};
    if (
      !identityId ||
      !genId ||
      !datasetId ||
      typeof imageIndex !== "number" ||
      imageIndex < 0
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "identityId, genId, datasetId and non-negative imageIndex are required"
      );
    }

    const genRef = db.collection("rp_generations").doc(genId);
    const genSnap = await genRef.get();
    if (!genSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Generation not found");
    }
    const gen = genSnap.data() || {};

    const urls = gen.resultImageUrls || [];
    if (!Array.isArray(urls) || imageIndex >= urls.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "imageIndex out of range for this generation"
      );
    }

    const datasetRef = db.collection("rp_datasets").doc(datasetId);
    const datasetSnap = await datasetRef.get();
    if (!datasetSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Dataset not found");
    }
    const dataset = datasetSnap.data() || {};
    if (dataset.identityId && dataset.identityId !== identityId) {
      console.warn(
        "[addGenerationImageToDataset] identityId mismatch between generation and dataset",
        identityId,
        dataset.identityId
      );
    }

    const srcUrl = urls[imageIndex];
    const destPath = `datasets/${datasetId}/${genId}_${imageIndex}.jpg`;
    const bucket = storage.bucket();
    const file = bucket.file(destPath);

    const resp = await fetch(srcUrl);
    if (!resp.ok) {
      const text = await resp.text();
      console.error(
        "[addGenerationImageToDataset] Failed to fetch source image:",
        text
      );
      throw new functions.https.HttpsError(
        "internal",
        "Failed to fetch source image for dataset copy"
      );
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = await resp.buffer();
    await file.save(buffer, { contentType });

    // Make the file publicly readable and construct public URL (avoids IAM permission issues)
    await file.makePublic();
    const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${destPath}`;
    console.log("[addGenerationImageToDataset] Generated download URL:", downloadUrl);

    // Map dataset.type into a dataset image kind; treat mixed as face by default.
    let kind = "face";
    if (dataset.type === "upper_body") kind = "upper_body";
    else if (dataset.type === "full_body") kind = "full_body";

    const imageDocRef = await db.collection("rp_dataset_images").add({
      datasetId,
      identityId,
      storagePath: destPath,
      downloadUrl,
      kind,
      source: "fal_inference",
      isApproved: false,
      prompt: gen.prompt || null,
      negativePrompt: gen.negativePrompt || null,
      seed: gen.seed || null,
      scale: gen.scale || null,
      steps: gen.steps || null,
      loraId: gen.loraId || null,
      falInferenceRequestId: gen.falRequestId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await genRef.set(
      {
        addedToDatasetId: datasetId,
      },
      { merge: true }
    );

    return {
      ok: true,
      storagePath: destPath,
      downloadUrl,
      datasetImageId: imageDocRef.id,
    };
  }
);

/**
 * Manually set the active LoRA artifact for an identity.
 * This is useful to override which artifact is used for inference.
 */
exports.setActiveLoraArtifact = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
      );
    }

    const { identityId, loraId } = data || {};
    if (!identityId || !loraId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "identityId and loraId are required"
      );
    }

    const artifactRef = db.collection("rp_lora_artifacts").doc(loraId);
    const artifactSnap = await artifactRef.get();
    if (!artifactSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Artifact not found");
    }

    const artifact = artifactSnap.data() || {};
    const identityRef = db.collection("rp_identities").doc(identityId);

    const activeScale =
      artifact.defaultScale ||
      artifact.recommendedScale ||
      artifact.recommendedScaleMin ||
      0.65;

    const updatePayload = {
      activeLoraArtifactId: loraId,
      // Keep defaultTriggerPhrase aligned with artifact trigger phrase
      defaultTriggerPhrase: artifact.triggerPhrase,
      activeTriggerPhrase: artifact.triggerPhrase,
      activeLoraScaleDefault: activeScale,
      activeInferenceEndpoint: "fal-ai/flux-lora",
      status: "trained",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Also set per-kind active artifact when tagged.
    if (artifact.artifactKind === "body") {
      updatePayload.activeBodyArtifactId = loraId;
    } else if (artifact.artifactKind === "face") {
      updatePayload.activeFaceArtifactId = loraId;
    }

    await identityRef.set(updatePayload, { merge: true });

    return { ok: true };
  }
);

/**
 * checkTrainingJob
 *
 * Callable polling function. The app (or a scheduler) can call this
 * periodically while a job is in "running" status.
 *
 * In a full implementation you would call the fal status endpoint.
 * For now we implement a minimal bridge:
 * - If FAL_API_KEY and job.falRequestId exist, you can plug in the real API.
 * - Otherwise we simulate completion and create a rp_lora_artifacts doc.
 */
exports.checkTrainingJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication is required."
    );
  }

  const { jobId } = data || {};
  if (!jobId || typeof jobId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "jobId (string) is required."
    );
  }

  const jobRef = db.collection("rp_training_jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Training job not found.");
  }
  const job = jobSnap.data();

  if (job.status !== "running") {
    return { status: job.status, message: "Job is not in running state." };
  }

  const FAL_API_KEY = getFalApiKey();
  let done = false;
  let loraWeightsUrl =
    job.loraWeightsUrl || `https://example.com/mock/${jobId}.safetensors`;
  let falResponseMeta = job.falResponseMeta || {};

  if (!FAL_API_KEY || !job.falRequestId) {
    // Stubbed completion for now
    console.warn(
      "[checkTrainingJob] FAL_API_KEY or falRequestId missing; stubbing completion."
    );
    done = true;
  } else {
    // TODO: call fal status endpoint with job.falRequestId and set done + loraWeightsUrl
    // This is left as a plug point so you can align with the actual fal API.
    done = true;
  }

  if (!done) {
    return { status: "running" };
  }

  // Mark job as completed and store outputs
  await jobRef.update({
    status: "completed",
    loraWeightsUrl,
    falResponseMeta,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Create LoRA artifact linked to this training job and identity
  let artifactKind = "face";
  try {
    if (job.datasetId) {
      const dsSnap = await db.collection("rp_datasets").doc(job.datasetId).get();
      if (dsSnap.exists) {
        const ds = dsSnap.data() || {};
        if (ds.type === "upper_body" || ds.type === "full_body" || ds.type === "mixed") {
          artifactKind = "body";
        }
      }
    }
  } catch (e) {
    console.warn("[checkTrainingJob] Failed to infer artifactKind from dataset:", e);
  }

  const artifactRef = await db.collection("rp_lora_artifacts").add({
    identityId: job.identityId,
    trainingJobId: jobRef.id,
    provider: "fal",
    weightsUrl: loraWeightsUrl,
    triggerPhrase: job.triggerPhrase,
    status: "active",
    name: job.name || `${job.identityId} LoRA v1`,
    trainerEndpoint: job.trainerEndpoint,
    datasetId: job.datasetId,
    recommendedScale: 0.65,
    recommendedScaleMin: 0.55,
    recommendedScaleMax: 0.85,
    defaultScale: 0.65,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    artifactKind,
  });

  // Optionally update RPIdentity.activeLoraId
  const identityRef = db.collection("rp_identities").doc(job.identityId);
  await identityRef.set(
    {
      // Keep trigger phrase in sync with artifact
      defaultTriggerPhrase: job.triggerPhrase,
      activeLoraArtifactId: artifactRef.id,
      status: "trained",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    status: "completed",
    loraWeightsUrl,
    loraArtifactId: artifactRef.id,
  };
});

/**
 * runGeneration
 *
 * Callable function used by the app's \"Generate\" screen.
 * Takes an identity + LoRA artifact and runs a fal.ai inference.
 * Persists the result as rp_generations/{genId}.
 */
exports.runGeneration = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication is required."
    );
  }

  const {
    identityId,
    loraId,
    endpoint,
    prompt,
    negativePrompt,
    scale,
    steps,
    seed,
    numImages,
    imageSize,
    loras: lorasInput,
  } = data || {};

  if (!identityId || !loraId || !prompt) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "identityId, loraId and prompt are required."
    );
  }

  const artifactRef = db.collection("rp_lora_artifacts").doc(loraId);
  const artifactSnap = await artifactRef.get();
  if (!artifactSnap.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "LoRA artifact not found."
    );
  }
  const artifact = artifactSnap.data() || {};

  // Optional: load rp_identity to pick up an active inference endpoint.
  let activeInferenceEndpoint = null;
  try {
    const identityRef = db.collection("rp_identities").doc(identityId);
    const identitySnap = await identityRef.get();
    if (identitySnap.exists) {
      const identity = identitySnap.data() || {};
      activeInferenceEndpoint = identity.activeInferenceEndpoint || null;
    }
  } catch (e) {
    console.warn("[runGeneration] Failed to load rp_identity for", identityId, e);
  }

  // Backend safety: ensure trigger phrase is present in the prompt.
  const triggerPhrase = artifact.triggerPhrase || "";
  let finalPrompt = prompt;
  if (
    triggerPhrase &&
    !prompt.toLowerCase().includes(triggerPhrase.toLowerCase())
  ) {
    finalPrompt = `${triggerPhrase}, ${prompt}`;
  }

  // Use provided endpoint, or identity's endpoint, or default
  // fal.ai inference endpoint is: fal-ai/flux-lora
  let effectiveEndpoint = endpoint || activeInferenceEndpoint || "fal-ai/flux-lora";
  
  // Fix old invalid endpoints
  if (effectiveEndpoint === "fal-ai/flux/schnell" || effectiveEndpoint === "fal-ai/flux/schnell-lora") {
    effectiveEndpoint = "fal-ai/flux-lora";
  }

  // Normalize requested LoRAs into an array; always include primary.
  const lorasNormalized = Array.isArray(lorasInput) && lorasInput.length
    ? lorasInput
    : [{ loraId, scale }];

  const resolvedLoras = [];
  for (const entry of lorasNormalized) {
    const entryId = entry && (entry.loraId || loraId);
    if (!entryId) continue;
    try {
      // Reuse already-loaded primary artifact when possible.
      let art = artifact;
      if (entry.loraId && entry.loraId !== loraId) {
        const ref = db.collection("rp_lora_artifacts").doc(entry.loraId);
        const snap = await ref.get();
        if (!snap.exists) continue;
        art = snap.data() || {};
      }

      resolvedLoras.push({
        loraId: entryId,
        weightsUrl: art.weightsUrl,
        scale:
          entry.scale ??
          scale ??
          art.defaultScale ??
          art.recommendedScale ??
          0.65,
      });
    } catch (e) {
      console.warn("[runGeneration] Failed to resolve stacked LoRA", entry, e);
    }
  }

  // Map imageSize to fal.ai preset strings
  // fal.ai expects: 'square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'
  let imageSizePreset = "square";
  if (imageSize) {
    const aspectRatio = imageSize.w / imageSize.h;
    if (Math.abs(aspectRatio - 1.0) < 0.1) {
      // Square (1:1)
      imageSizePreset = imageSize.w >= 1024 ? "square_hd" : "square";
    } else if (aspectRatio < 1.0) {
      // Portrait (height > width)
      if (Math.abs(aspectRatio - 4/3) < 0.1) {
        imageSizePreset = "portrait_4_3";
      } else {
        imageSizePreset = "portrait_16_9";
      }
    } else {
      // Landscape (width > height)
      if (Math.abs(aspectRatio - 4/3) < 0.1) {
        imageSizePreset = "landscape_4_3";
      } else {
        imageSizePreset = "landscape_16_9";
      }
    }
  }

  // Build fal.ai API-compatible payload
  // fal.ai expects: prompt, lora_url, num_images, image_size (preset string), lora_scale, etc.
  const falPayload = {
    prompt: finalPrompt,
    lora_url: artifact.weightsUrl, // Primary LoRA URL
    num_images: numImages || 1,
    image_size: imageSizePreset,
    lora_scale: scale || 0.65,
    ...(negativePrompt && { negative_prompt: negativePrompt }),
    ...(seed && { seed }),
    ...(steps && { num_inference_steps: steps }),
  };
  
  // If multi-LoRA stacking, add lora_urls array
  if (resolvedLoras.length > 1) {
    falPayload.lora_urls = resolvedLoras.map(l => l.weightsUrl);
    falPayload.lora_scales = resolvedLoras.map(l => l.scale);
  }

  const FAL_API_KEY = getFalApiKey();
  let resultImageUrls = [];
  let falRequestId = `local-gen-${Date.now()}`;
  let falResponseMeta = { stubbed: true };

  if (!FAL_API_KEY) {
    console.warn(
      "[runGeneration] FAL_API_KEY not set; skipping real API call and stubbing output."
    );
    resultImageUrls = [
      `https://example.com/mock-generation/${loraId}/${Date.now()}-1.png`,
    ];
  } else {
    try {
      const url = resolveFalUrl(effectiveEndpoint);

      // -----------------------------------------------------------------
      // Debug logging: fal inference endpoint + payload shape.
      // Logs are sanitized and do NOT include full prompts or secrets.
      // -----------------------------------------------------------------
      functions.logger.info("[runGeneration] Calling fal inference", {
        endpoint: url,
        effectiveEndpoint,
        identityId,
        loraId,
        loras: resolvedLoras,
        numImages: falPayload.numImages,
        imageSize: falPayload.imageSize,
        seed: falPayload.seed,
        promptLength: (finalPrompt || "").length,
        negativePromptLength: (negativePrompt || "").length,
      });

      // Additional contract introspection logs for endpoint + payload.
      functions.logger.info("[runGeneration] effectiveEndpoint", {
        effectiveEndpoint,
      });
      functions.logger.info("[runGeneration] resolvedUrl", { url });
      functions.logger.info("[runGeneration] falPayload", falPayload);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${FAL_API_KEY}`,
        },
        body: JSON.stringify(falPayload),
      });

      if (!response.ok) {
        const text = await response.text();
        let errorDetails = text;
        try {
          const errorJson = JSON.parse(text);
          errorDetails = JSON.stringify(errorJson, null, 2);
        } catch (e) {
          // Keep as text if not JSON
        }
        console.error("[runGeneration] fal inference error:", {
          status: response.status,
          statusText: response.statusText,
          url: url,
          error: errorDetails,
        });
        throw new functions.https.HttpsError(
          "internal",
          `fal inference error (${response.status}): ${response.statusText}. Endpoint: ${url}`
        );
      }

      const json = await response.json();
      functions.logger.info("[runGeneration] falResponseMeta", json);
      falRequestId = json.request_id || json.id || falRequestId;
      falResponseMeta = json;

      // fal.ai uses a queue system - initial response has status_url and response_url
      // We need to poll until the request is completed, then fetch the results
      if (json.status === "IN_QUEUE" || json.status === "IN_PROGRESS") {
        // Poll the status URL until completed
        const statusUrl = json.status_url || `${url}/requests/${falRequestId}/status`;
        const maxAttempts = 60; // 5 minutes max (5 second intervals)
        let attempts = 0;
        let completed = false;

        while (!completed && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
          attempts++;

          try {
            const statusResponse = await fetch(statusUrl, {
              headers: {
                Authorization: `Key ${FAL_API_KEY}`,
              },
            });

            if (statusResponse.ok) {
              const statusJson = await statusResponse.json();
              functions.logger.info(`[runGeneration] Status check ${attempts}:`, {
                status: statusJson.status,
                request_id: falRequestId,
              });

              if (statusJson.status === "COMPLETED") {
                completed = true;
                // Fetch the actual results
                const responseUrl = json.response_url || `${url}/requests/${falRequestId}`;
                const resultResponse = await fetch(responseUrl, {
                  headers: {
                    Authorization: `Key ${FAL_API_KEY}`,
                  },
                });

                if (resultResponse.ok) {
                  const resultJson = await resultResponse.json();
                  functions.logger.info("[runGeneration] Result JSON from response_url:", {
                    keys: Object.keys(resultJson),
                    hasImages: !!resultJson.images,
                    hasOutputs: !!resultJson.outputs,
                    hasOutput: !!resultJson.output,
                    hasUrl: !!resultJson.url,
                    imagesType: Array.isArray(resultJson.images) ? "array" : typeof resultJson.images,
                    imagesLength: Array.isArray(resultJson.images) ? resultJson.images.length : "N/A",
                  });
                  falResponseMeta = { ...falResponseMeta, ...resultJson };

                  // Extract image URLs from the result
                  const urlsFromJson =
                    resultJson.images ||
                    resultJson.resultImageUrls ||
                    resultJson.outputs ||
                    resultJson.output ||
                    [];

                  functions.logger.info("[runGeneration] Extracted URLs:", {
                    urlsFromJsonType: Array.isArray(urlsFromJson) ? "array" : typeof urlsFromJson,
                    urlsFromJsonLength: Array.isArray(urlsFromJson) ? urlsFromJson.length : "N/A",
                    urlsFromJsonSample: Array.isArray(urlsFromJson) ? urlsFromJson.slice(0, 2) : urlsFromJson,
                  });

                  if (Array.isArray(urlsFromJson)) {
                    resultImageUrls = urlsFromJson
                      .map((item) =>
                        typeof item === "string" ? item : item.url || item.image_url
                      )
                      .filter(Boolean);
                  }

                  if (!resultImageUrls.length && resultJson.url) {
                    resultImageUrls = [resultJson.url];
                  }

                  functions.logger.info("[runGeneration] Final resultImageUrls:", {
                    count: resultImageUrls.length,
                    urls: resultImageUrls,
                  });
                } else {
                  const errorText = await resultResponse.text();
                  functions.logger.error("[runGeneration] Failed to fetch result:", {
                    status: resultResponse.status,
                    statusText: resultResponse.statusText,
                    error: errorText,
                  });
                }
              } else if (statusJson.status === "FAILED") {
                throw new Error(`fal.ai request failed: ${statusJson.error || "Unknown error"}`);
              }
            }
          } catch (pollError) {
            console.error("[runGeneration] Error polling status:", pollError);
            // Continue polling on error
          }
        }

        if (!completed) {
          throw new Error("fal.ai request timed out after polling");
        }
      } else {
        // If status is already COMPLETED, try to extract URLs directly
        const urlsFromJson =
          json.images ||
          json.resultImageUrls ||
          json.outputs ||
          json.output ||
          [];

        if (Array.isArray(urlsFromJson)) {
          resultImageUrls = urlsFromJson
            .map((item) =>
              typeof item === "string" ? item : item.url || item.image_url
            )
            .filter(Boolean);
        }

        if (!resultImageUrls.length && json.url) {
          resultImageUrls = [json.url];
        }
      }
    } catch (err) {
      console.error("[runGeneration] Error calling fal inference:", err);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to run inference with fal."
      );
    }
  }

  // Filter out undefined values from falPayload before saving to Firestore
  const sanitizedFalPayload = Object.fromEntries(
    Object.entries(falPayload).filter(([_, value]) => value !== undefined)
  );

  const genRef = await db.collection("rp_generations").add({
    identityId,
    loraId,
    provider: "fal",
    endpoint: effectiveEndpoint,
    prompt: finalPrompt,
    scale,
    resultImageUrls,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    negativePrompt: negativePrompt || null,
    steps: steps || null,
    seed: seed || null,
    imageSize: imageSize || null,
    numImages: numImages || (resultImageUrls.length || 1),
    falRequestId,
    falRequestPayload: sanitizedFalPayload,
    falResponseMeta,
  });

  return { genId: genRef.id, resultImageUrls };
});

/**
 * Check and remove duplicate images in a dataset.
 * Duplicates are identified by:
 * 1. Same storagePath
 * 2. Same downloadUrl
 * 
 * For each duplicate group, keeps the oldest image (by createdAt) and removes the rest.
 */
exports.removeDuplicateImages = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { datasetId } = data;
  if (!datasetId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "datasetId is required"
    );
  }

  console.log(`[removeDuplicateImages] Checking dataset: ${datasetId}`);

  // Fetch all images for this dataset
  const imagesRef = db.collection("rp_dataset_images");
  const snapshot = await imagesRef
    .where("datasetId", "==", datasetId)
    .get();

  if (snapshot.empty) {
    return {
      success: true,
      message: "No images found for this dataset",
      totalImages: 0,
      duplicatesFound: 0,
      removed: 0,
    };
  }

  const images = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    images.push({
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toMillis?.() || (data.createdAt?.seconds ? data.createdAt.seconds * 1000 : Date.now()),
    });
  });

  console.log(`[removeDuplicateImages] Found ${images.length} images`);

  // Group by storagePath to find duplicates
  const byStoragePath = new Map();
  images.forEach((img) => {
    if (img.storagePath) {
      if (!byStoragePath.has(img.storagePath)) {
        byStoragePath.set(img.storagePath, []);
      }
      byStoragePath.get(img.storagePath).push(img);
    }
  });

  // Group by downloadUrl to find duplicates
  const byDownloadUrl = new Map();
  images.forEach((img) => {
    if (img.downloadUrl) {
      if (!byDownloadUrl.has(img.downloadUrl)) {
        byDownloadUrl.set(img.downloadUrl, []);
      }
      byDownloadUrl.get(img.downloadUrl).push(img);
    }
  });

  // Find duplicates
  const duplicatesToRemove = new Set();

  // Check storagePath duplicates
  for (const [storagePath, imgs] of byStoragePath.entries()) {
    if (imgs.length > 1) {
      console.log(`[removeDuplicateImages] Found ${imgs.length} images with same storage path: ${storagePath}`);
      // Sort by createdAt (oldest first) and keep the first one
      imgs.sort((a, b) => a.createdAt - b.createdAt);
      // Mark all except the first (oldest) for removal
      for (let i = 1; i < imgs.length; i++) {
        duplicatesToRemove.add(imgs[i].id);
      }
    }
  }

  // Check downloadUrl duplicates
  for (const [downloadUrl, imgs] of byDownloadUrl.entries()) {
    if (imgs.length > 1) {
      // Only process if not already marked for removal
      const unprocessed = imgs.filter((img) => !duplicatesToRemove.has(img.id));
      if (unprocessed.length > 1) {
        console.log(`[removeDuplicateImages] Found ${imgs.length} images with same download URL`);
        // Sort by createdAt (oldest first) and keep the first one
        unprocessed.sort((a, b) => a.createdAt - b.createdAt);
        // Mark all except the first (oldest) for removal
        for (let i = 1; i < unprocessed.length; i++) {
          duplicatesToRemove.add(unprocessed[i].id);
        }
      }
    }
  }

  if (duplicatesToRemove.size === 0) {
    return {
      success: true,
      message: "No duplicates found",
      totalImages: images.length,
      duplicatesFound: 0,
      removed: 0,
    };
  }

  console.log(`[removeDuplicateImages] Found ${duplicatesToRemove.size} duplicates to remove`);

  // Get the images to remove
  const imagesToRemove = images.filter((img) => duplicatesToRemove.has(img.id));

  // Remove from Firestore
  let removedCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const img of imagesToRemove) {
    try {
      await db.collection("rp_dataset_images").doc(img.id).delete();
      console.log(`[removeDuplicateImages] Removed: ${img.id}`);
      removedCount++;
    } catch (error) {
      console.error(`[removeDuplicateImages] Error removing ${img.id}:`, error.message);
      errorCount++;
      errors.push({ id: img.id, error: error.message });
    }
  }

  return {
    success: true,
    message: `Removed ${removedCount} duplicate image(s)`,
    totalImages: images.length,
    duplicatesFound: duplicatesToRemove.size,
    removed: removedCount,
    errors: errorCount > 0 ? errors : undefined,
  };
});

// ---------------------------------------------------------------------------
// Product System Functions
// ---------------------------------------------------------------------------

/**
 * Helper: Generate slug from product name
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Helper: Resolve prompt template tokens
 */
function resolvePromptTemplate(template, context) {
  if (!template) return "";
  
  let resolved = template;
  for (const [key, value] of Object.entries(context)) {
    const token = `{${key}}`;
    resolved = resolved.replace(new RegExp(token, "g"), value || "");
  }
  return resolved.trim();
}

/**
 * Legacy single-doc product creation — **disabled**.
 * All new products must use `createProductFromDesignBlank` (parent + variants).
 */
exports.createProduct = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }
  console.warn("[createProduct] Blocked legacy call from uid:", context.auth.uid);
  throw new functions.https.HttpsError(
    "failed-precondition",
    "Legacy product creation is disabled. Use Products → Create from Design + Blank or Generate Team Products to create a parent product and color variants."
  );
});

/**
 * Initialize renderSetup so mockup generation does not require manual "Set design".
 * Placement defaults come from `blank.defaultPrintSides` (∩ design artwork sides).
 */
function buildInitialRenderSetupForProduct({ design, blank, variantRow, designId }) {
  const designPngUrl = designPngUrlForProcessing(design);
  const frontBlankUrl =
    (variantRow.images && variantRow.images.front && variantRow.images.front.downloadUrl) ||
    (blank.images && blank.images.front && blank.images.front.downloadUrl) ||
    null;
  const backBlankUrl =
    (variantRow.images && variantRow.images.back && variantRow.images.back.downloadUrl) ||
    (blank.images && blank.images.back && blank.images.back.downloadUrl) ||
    null;
  const r = resolvePrintSidesForProductBuild(blank, design);

  if (!designPngUrl) {
    return {
      designIdFront: null,
      designIdBack: null,
      renderSetup: null,
      renderConfig: null,
    };
  }

  if (!r.canGenerate) {
    return {
      designIdFront: null,
      designIdBack: null,
      renderSetup: null,
      renderConfig: null,
    };
  }

  const effFront = r.effectiveFront;
  const effBack = r.effectiveBack;

  return {
    designIdFront: effFront ? designId : null,
    designIdBack: effBack ? designId : null,
    renderSetup: {
      defaults: {
        blankId: blank.blankId,
        designIdFront: effFront ? designId : null,
        designIdBack: effBack ? designId : null,
      },
      front: {
        blankImageUrl: frontBlankUrl,
        designAssetId: effFront ? designId : null,
        designAssetUrl: effFront ? designPngUrl : null,
        placementKey: "front_center",
      },
      back: {
        blankImageUrl: backBlankUrl,
        designAssetId: effBack ? designId : null,
        designAssetUrl: effBack ? designPngUrl : null,
        placementKey: "back_center",
      },
    },
    renderConfig: {
      renderSide: r.primaryPlacementSide,
      selectedBlankId: blank.blankId,
    },
  };
}

/**
 * Create a product from Design + Blank (product-first workflow).
 * Phase 1: one parent `rp_products` row per team+design+blank; color variants live in
 * `rp_products/{parentId}/variants/{variantId}`. Legacy single-doc products use `productIdentityKey` only.
 */
exports.createProductFromDesignBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { designId, blankId, blankVariantId } = data || {};
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }
  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }

  const out = await runCreateProductFromDesignBlankCore({
    db,
    admin,
    functions,
    designPngUrlForProcessing,
    buildInitialRenderSetupForProduct,
    resolveBlankVariantForProduct,
    buildProductIdentityKey,
    buildParentProductIdentityKey,
    MASTER_BLANK_SCHEMA_VERSION,
    sanitizeForFirestore,
    deriveAvailableSizesFromBlank,
    deriveSizesForProductMatrix,
    merchandisingAtCreate,
    resolveBlankTemplates,
    designId,
    blankId,
    blankVariantId,
    userId: context.auth.uid,
  });

  let assetBatch = null;
  if (out && out.ok && out.productId && Array.isArray(out.variantIds) && out.variantIds.length > 0) {
    try {
      assetBatch = await startInitialProductAssetBatch({
        db,
        admin,
        sanitizeForFirestore,
        deriveSizesForProductMatrix,
        productId: out.productId,
        variantIds: out.variantIds,
        userId: context.auth.uid,
        force: (data || {}).forceAssetBatch === true,
      });
    } catch (e) {
      console.error("[createProductFromDesignBlank] startInitialProductAssetBatch:", e && e.message ? e.message : e);
    }
  }

  return { ...out, assetBatch };
});

/**
 * Create many color variants for one design + blank in a **single** function invocation.
 * Ensures one parent `rp_products` doc and N subdocs under `variants/` (no per-call cold starts;
 * parent is visible to subsequent iterations). Prefer this for Generate Team Products.
 */
exports.createProductVariantsFromDesignBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { designId, blankId, blankVariantIds } = data || {};
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }
  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }
  if (!Array.isArray(blankVariantIds) || blankVariantIds.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "blankVariantIds must be a non-empty array of variant ids"
    );
  }
  if (blankVariantIds.length > 48) {
    throw new functions.https.HttpsError("invalid-argument", "Too many variants (max 48 per request)");
  }

  const uid = context.auth.uid;
  const uniqueIds = [...new Set(blankVariantIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "No valid blankVariantIds after dedupe");
  }

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  const blankData = blankSnap.exists ? blankSnap.data() : null;
  const blankVariantIdsAll = Array.isArray(blankData?.variants)
    ? blankData.variants.map((v) => v.variantId).filter(Boolean)
    : [];
  const blankVariantIdsActive = Array.isArray(blankData?.variants)
    ? blankData.variants.filter((v) => v.isActive !== false).map((v) => v.variantId).filter(Boolean)
    : [];
  let blankSizes = [];
  try {
    blankSizes = blankData ? deriveSizesForProductMatrix(blankData) : [];
  } catch (e) {
    blankSizes = [];
  }

  console.log(
    JSON.stringify({
      tag: "[TEAM_PRODUCT_GEN:SERVER:ENTRY]",
      callable: "createProductVariantsFromDesignBlank",
      designId,
      blankId,
      selectedBlankVariantIds: uniqueIds,
      selectedCount: uniqueIds.length,
      userId: uid,
      timestamp: new Date().toISOString(),
    })
  );
  console.log(
    JSON.stringify({
      tag: "[TEAM_PRODUCT_GEN:SERVER:BLANK]",
      blankId,
      blankExists: blankSnap.exists,
      styleCode: blankData?.styleCode ?? null,
      blankVariantIdsAll,
      blankVariantIdsActive,
      blankSizes,
    })
  );

  return executeTeamProductVariantCreation({
    db,
    admin,
    functions,
    runCreateProductFromDesignBlankCore,
    designPngUrlForProcessing,
    buildInitialRenderSetupForProduct,
    resolveBlankVariantForProduct,
    buildProductIdentityKey,
    buildParentProductIdentityKey,
    MASTER_BLANK_SCHEMA_VERSION,
    sanitizeForFirestore,
    deriveAvailableSizesFromBlank,
    deriveSizesForProductMatrix,
    merchandisingAtCreate,
    resolveBlankTemplates,
    designId,
    blankId,
    uniqueIds,
    blankData,
    uid,
    forceAssetBatch: (data || {}).forceAssetBatch === true,
  });
});

/**
 * One-click product launch: materialize variants, metadata defaults, initial assets, and (when complete) Shopify readiness.
 */
exports.launchProductsFromDesign = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { designId, blankId, blankVariantIds, forceAssetBatch, autoSyncShopify, queue8394Secondary, forceMatrix } = data || {};
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }
  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }

  const uid = context.auth.uid;
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  const blankData = blankSnap.exists ? blankSnap.data() : null;

  // `forceMatrix=true` means "use every active variant on this blank" — bypasses the UI's
  // team-catalog-matrix gate so callers (UI buttons, triggers) can auto-launch without
  // requiring an admin to opt the team into each color first.
  let uniqueIds;
  if (forceMatrix === true) {
    if (!blankData) {
      throw new functions.https.HttpsError("not-found", `Blank not found: ${blankId}`);
    }
    const variants = Array.isArray(blankData.variants) ? blankData.variants : [];
    const derived = variants
      .filter((v) => v && v.isActive !== false)
      .map((v) => v.variantId)
      .filter(Boolean);
    if (derived.length === 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Blank ${blankId} has no active variants — cannot launch with forceMatrix`
      );
    }
    uniqueIds = [...new Set(derived.map((x) => String(x || "").trim()).filter(Boolean))];
  } else {
    if (!Array.isArray(blankVariantIds) || blankVariantIds.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "blankVariantIds must be a non-empty array of variant ids (or pass forceMatrix:true)"
      );
    }
    if (blankVariantIds.length > 48) {
      throw new functions.https.HttpsError("invalid-argument", "Too many variants (max 48 per request)");
    }
    uniqueIds = [...new Set(blankVariantIds.map((x) => String(x || "").trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "No valid blankVariantIds after dedupe");
    }
  }

  console.log(
    JSON.stringify({
      tag: "[LAUNCH_PRODUCTS:SERVER:ENTRY]",
      callable: "launchProductsFromDesign",
      designId,
      blankId,
      selectedBlankVariantIds: uniqueIds,
      forceMatrix: forceMatrix === true,
      autoSyncShopify: autoSyncShopify === true,
      queue8394Secondary: queue8394Secondary === true,
      userId: uid,
      timestamp: new Date().toISOString(),
    })
  );

  return launchProductsFromDesign({
    db,
    admin,
    functions,
    runCreateProductFromDesignBlankCore,
    designPngUrlForProcessing,
    buildInitialRenderSetupForProduct,
    resolveBlankVariantForProduct,
    buildProductIdentityKey,
    buildParentProductIdentityKey,
    MASTER_BLANK_SCHEMA_VERSION,
    sanitizeForFirestore,
    deriveAvailableSizesFromBlank,
    deriveSizesForProductMatrix,
    merchandisingAtCreate,
    resolveBlankTemplates,
    designId,
    blankId,
    uniqueIds,
    blankData,
    uid,
    forceAssetBatch: forceAssetBatch === true,
    autoSyncShopify: autoSyncShopify === true,
    queue8394Secondary: queue8394Secondary === true,
  });
});

/**
 * Phase 2: auto-launch products for every active master blank when a design is created
 * (or first gets a PNG attached). One product per (design × team × active master blank)
 * using all active blank variants. Idempotent: stamps `autoLaunchProductsAt` and skips
 * subsequent writes. No-op when the design lacks a teamId, is archived, or has no PNG yet.
 *
 * Uses onWrite so we can wait for the PNG-attach update — bulk + single-design flows both
 * create the doc with `files.lightPng = null` and patch it after upload.
 */
/**
 * 540s/2GB: auto-launch runs product creation + official asset composition (Sharp
 * renders + uploads) INLINE for every targeted blank × color. At the 60s default the
 * trigger died mid-render on multi-blank launches — first blank's product spawned,
 * the rest never ran (observed: Rally Orange created only the tank), and earlier
 * "batch complete but 0 renders written" was the same guillotine mid-loop.
 */
exports.onDesignCreated = functions
  .runWith({ memory: "2GB", timeoutSeconds: 540 })
  .firestore.document("designs/{designId}")
  .onWrite(async (change, context) => {
    // Lazy: helpers below are defined later in this file (TDZ at module-load time).
    const handler = buildOnDesignCreated({
      db,
      admin,
      functions,
      runCreateProductFromDesignBlankCore,
      designPngUrlForProcessing,
      buildInitialRenderSetupForProduct,
      resolveBlankVariantForProduct,
      buildProductIdentityKey,
      buildParentProductIdentityKey,
      MASTER_BLANK_SCHEMA_VERSION,
      sanitizeForFirestore,
      deriveAvailableSizesFromBlank,
      deriveSizesForProductMatrix,
      merchandisingAtCreate,
      resolveBlankTemplates,
    });
    return handler(change, context);
  });

/** Bulk approve or hold products after human review (moves approved rows to `shopify_ready`). */
exports.bulkMarkProductsReviewed = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const { productIds, action } = data || {};
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "productIds must be a non-empty array");
  }
  if (productIds.length > 100) {
    throw new functions.https.HttpsError("invalid-argument", "Maximum 100 products per request");
  }
  if (action !== "approve" && action !== "hold") {
    throw new functions.https.HttpsError("invalid-argument", "action must be approve or hold");
  }
  const uid = context.auth.uid;
  const ids = [...new Set(productIds.map((x) => String(x || "").trim()).filter(Boolean))];
  return bulkMarkProductsReviewed({
    db,
    admin,
    sanitizeForFirestore,
    productIds: ids,
    action,
    userId: uid,
  });
});

/** Enqueue Shopify sync jobs for products in `shopify_ready` state. */
exports.bulkSyncProductsToShopify = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const { productIds } = data || {};
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "productIds must be a non-empty array");
  }
  if (productIds.length > 50) {
    throw new functions.https.HttpsError("invalid-argument", "Maximum 50 products per request");
  }
  const uid = context.auth.uid;
  const ids = [...new Set(productIds.map((x) => String(x || "").trim()).filter(Boolean))];
  return bulkSyncProductsToShopify({
    db,
    admin,
    sanitizeForFirestore,
    productIds: ids,
    userId: uid,
  });
});

/** Retry initial 8394 asset batch for selected parent products (force re-enqueue). */
exports.bulkRetryProductAssets = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const { productIds } = data || {};
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "productIds must be a non-empty array");
  }
  if (productIds.length > 25) {
    throw new functions.https.HttpsError("invalid-argument", "Maximum 25 products per request");
  }
  const uid = context.auth.uid;
  const ids = [...new Set(productIds.map((x) => String(x || "").trim()).filter(Boolean))];
  return bulkRetryProductAssets({
    db,
    admin,
    sanitizeForFirestore,
    deriveSizesForProductMatrix,
    productIds: ids,
    userId: uid,
  });
});

/**
 * Recompute merchandising fields from linked design + blank + team (same rules as createProductFromDesignBlank).
 * Use to repair legacy products or after taxonomy/design updates.
 */
exports.refreshProductMerchandisingFromSources = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const { productId } = data || {};
  if (!productId || typeof productId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "productId is required");
  }

  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Product not found");
  }
  const product = productSnap.data();
  const designId = product.designId;
  const blankId = product.blankId;
  if (!designId || !blankId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Product needs designId and blankId to refresh merchandising"
    );
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!designSnap.exists || !blankSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Design or blank not found");
  }
  const design = designSnap.data();
  const blank = blankSnap.data();

  let team = null;
  if (design.teamId) {
    const teamSnap = await db.collection("design_teams").doc(design.teamId).get();
    if (teamSnap.exists) {
      const teamData = teamSnap.data();
      team = {
        id: teamSnap.id,
        name: teamData.name ?? null,
        teamCode: teamData.teamCode ?? null,
        city: teamData.city ?? null,
        teamName: teamData.teamName ?? null,
        league: teamData.league ?? null,
        leagueId: teamData.leagueId ?? null,
        leagueCode: teamData.leagueCode ?? null,
        stadiumName: teamData.stadiumName ?? null,
        teamSaying: teamData.teamSaying ?? null,
        fanPhrase: teamData.fanPhrase ?? null,
        slug: teamData.slug ?? null,
      };
    }
  }

  const isParent = product.productKind === "parent";

  const teamNameFull = merchandisingAtCreate.buildTeamDisplayName(team, design);
  const designShortName = merchandisingAtCreate.designTypeToStorefrontShort(design.designType);
  const designName = merchandisingAtCreate.buildDesignNameForTemplates(design, teamNameFull, designShortName);
  const teamName =
    (team && team.teamName && String(team.teamName).trim()) ||
    teamNameFull ||
    "Design";
  const designThemeLabel = merchandisingAtCreate.designTypeToLabel(design.designType);
  const designThemeSlug = merchandisingAtCreate.designTypeToThemeSlug(design.designType);

  const blankVariantId = product.blankVariantId;
  const variantRow = !isParent ? resolveBlankVariantForProduct(blank, blankVariantId) : null;
  const colorNameForProduct = variantRow ? variantRow.colorName || "" : "";

  const designSeriesStr =
    design.designSeries != null && String(design.designSeries).trim()
      ? String(design.designSeries).trim()
      : "";
  const templateContext = {
    teamName,
    teamNameFull,
    designName,
    designShortName,
    designSeries: designSeriesStr,
    colorName: colorNameForProduct,
    garmentStyle: blank.garmentStyle || blank.styleName || blank.styleCode || "",
    category: blank.shopifyDefaults?.productType ?? blank.category ?? blank.garmentCategory ?? "",
    brand: blank.shopifyDefaults?.brand ?? blank.shopifyDefaults?.vendor ?? "",
    vendor: blank.shopifyDefaults?.brand ?? blank.shopifyDefaults?.vendor ?? "",
    league: team?.league ?? "",
    city: team?.city ?? "",
    stadiumName: team?.stadiumName ?? "",
    teamSaying: team?.teamSaying ?? "",
    fanPhrase: team?.fanPhrase ?? "",
    designThemeLabel,
    designTheme: design.designType ?? "",
    designThemeSlug,
    designStyle: designThemeLabel,
    teamCity: team?.city ?? "",
  };

  let bundle;
  if (isParent) {
    const templateContextParent = { ...templateContext, colorName: "" };
    const resolvedParent = resolveBlankTemplates(blank, templateContextParent);
    bundle = merchandisingAtCreate.buildResolvedMerchandisingBundleForParent({
      team,
      design,
      blank,
      resolvedBlankDescription: resolvedParent.description,
    });
  } else {
    const resolved = resolveBlankTemplates(blank, templateContext);
    bundle = merchandisingAtCreate.buildResolvedMerchandisingBundle({
      team,
      design,
      blank,
      colorNameForProduct,
      resolvedBlankDescription: resolved.description,
    });
  }

  let slug = bundle.handleSlug;
  const dup = await db.collection("rp_products").where("slug", "==", slug).get();
  if (!dup.empty && dup.docs[0].id !== productId) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }
  const handle = slug;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;

  const refreshPayload = {
    slug,
    handle,
    name: bundle.displayTitle,
    title: bundle.displayTitle,
    description: bundle.descriptionText || null,
    descriptionHtml: bundle.descriptionHtml || null,
    descriptionText: bundle.descriptionText || null,
    shortDescription: bundle.shortDescription || null,
    seo: bundle.seo
      ? {
          title: bundle.seo.title ?? null,
          description: bundle.seo.description ?? null,
        }
      : undefined,
    tags: bundle.tags,
    tagsNormalized: bundle.tagsNormalized,
    collectionKeys: bundle.collectionKeys?.length ? bundle.collectionKeys : null,
    sportCode: bundle.tax.sportCode ?? null,
    leagueCode: bundle.tax.leagueCode ?? null,
    teamCode:
      bundle.tax.teamCode ??
      (team && team.teamCode && String(team.teamCode).trim()
        ? String(team.teamCode).trim().toUpperCase()
        : null) ??
      (design.teamCode && String(design.teamCode).trim()
        ? String(design.teamCode).trim().toUpperCase()
        : null),
    themeCode: bundle.tax.themeCode ?? null,
    designFamily: bundle.tax.designFamily ?? null,
    taxonomy: bundle.tax.taxonomy ?? null,
    updatedAt: now,
    updatedBy: userId,
  };
  if (isParent) {
    refreshPayload.teamName = team?.name ?? design.teamNameCache ?? null;
    refreshPayload.designName = design.name ?? null;
    refreshPayload.designSeries = design.designSeries ?? null;
    refreshPayload.blankStyleCode = blank.styleCode ?? null;
    refreshPayload.blankStyleName = blank.styleName || blank.garmentStyle || null;
    refreshPayload.availableSizes = deriveAvailableSizesFromBlank(blank);
  }

  await productRef.update(sanitizeForFirestore(refreshPayload));

  return { ok: true, productId, slug };
});

/**
 * Step 10 MVP: 8394 variant-native flats. Callable args: productId, productVariantId (required for parent),
 * optional renderTypes. When omitted, expands from variant sources (flat/model back + front URLs).
 * Fallback when expansion is empty: model_blended_back, flat_clean_front, flat_blended_back, model_clean_front.
 * Writes `rp_products/{productId}/variants/{variantId}` only (flatRenders, media.heroBack/heroFront, gallery, mockupUrl).
 */
exports.generateProductFlatRenders = createRegisterGenerateProductFlatRenders({
  admin,
  db,
  storage,
  fetch,
  crypto,
});

/**
 * MVP: flat_blended → deterministic hanger (crewneck) scene. Non-AI.
 * Env: SCENE_HANGER_CREWNECK_BACKGROUND_URL (required), SCENE_HANGER_CREWNECK_SHADOW_URL (optional).
 */
exports.generateProductSceneRender = createRegisterGenerateProductSceneRender({
  admin,
  db,
  storage,
  fetch,
});

const {
  NEUTRAL_HANGER_SCENE_KEY,
  processNeutralHangerSceneJob,
} = require("./lib/sceneRenderNeutralHangerJob");
const {
  BACKDROP_NEUTRAL_SCENE_KEY,
  processBackdropNeutralSceneJob,
} = require("./lib/sceneRenderBackdropNeutralJob");
const { FLATLAY_SCENE_KEYS, processFlatlaySceneJob } = require("./lib/sceneRenderFlatlayJobs");
const {
  BODY_MODEL_SCENE_KEY,
  processBodyModelSceneJob,
} = require("./lib/sceneRenderBodyModelJob");
const { productMatchesSceneTemplate } = require("./lib/sceneTemplateEligibility");

const SUPPORTED_SCENE_RENDER_KEYS = new Set([
  NEUTRAL_HANGER_SCENE_KEY,
  BACKDROP_NEUTRAL_SCENE_KEY,
  BODY_MODEL_SCENE_KEY,
  ...FLATLAY_SCENE_KEYS,
]);

/**
 * Queue a deterministic scene render job. Creates `rp_scene_render_jobs/{jobId}`; worker processes async.
 */
exports.createSceneRenderJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const productId = data && data.productId;
  const productVariantId = data && data.productVariantId;
  const sceneKey = (data && data.sceneKey) || NEUTRAL_HANGER_SCENE_KEY;
  if (!productId || typeof productId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "productId is required");
  }
  if (!productVariantId || typeof productVariantId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "productVariantId is required");
  }
  if (!SUPPORTED_SCENE_RENDER_KEYS.has(sceneKey)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Unsupported sceneKey "${sceneKey}". Supported: ${[...SUPPORTED_SCENE_RENDER_KEYS].join(", ")}`
    );
  }

  const productRef = db.collection("rp_products").doc(productId);
  const vRef = productRef.collection("variants").doc(productVariantId);
  const [vSnap, productSnap, templateSnap] = await Promise.all([
    vRef.get(),
    productRef.get(),
    db.collection("rp_scene_templates").doc(sceneKey).get(),
  ]);
  if (!vSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Variant not found");
  }
  if (!productSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Product not found");
  }
  const variant = vSnap.data();
  const product = productSnap.data();
  const templateDoc = templateSnap.exists ? templateSnap.data() : {};
  if (templateSnap.exists && templateDoc.status === "archived") {
    throw new functions.https.HttpsError("failed-precondition", "Scene template is archived");
  }
  if (!productMatchesSceneTemplate(product, templateDoc)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This product is not eligible for the selected scene template (category / product type)."
    );
  }

  const uid = context.auth.uid;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const jobRef = await db.collection("rp_scene_render_jobs").add({
    productId,
    productVariantId,
    blankVariantId: variant.blankVariantId || "",
    sceneTemplateId: sceneKey,
    sceneKey,
    jobType: "scene_render",
    generationScope: "single_variant",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
    updatedBy: uid,
  });

  return { ok: true, jobId: jobRef.id };
});

exports.onSceneRenderJobCreated = functions
  .runWith({ memory: "1GB", timeoutSeconds: 300 })
  .firestore.document("rp_scene_render_jobs/{jobId}")
  .onCreate(async (snap, ctx) => {
    const jobId = ctx.params.jobId;
    const jobRef = snap.ref;
    const job = snap.data() || {};

    if (job.jobType !== "scene_render") {
      await jobRef.update({
        status: "failed",
        errorMessage: `Unsupported jobType: ${job.jobType || "missing"}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    if (!SUPPORTED_SCENE_RENDER_KEYS.has(job.sceneKey)) {
      await jobRef.update({
        status: "failed",
        errorMessage: `Scene not implemented: ${job.sceneKey}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const nowTs = admin.firestore.FieldValue.serverTimestamp();
    await jobRef.update({ status: "running", updatedAt: nowTs });

    try {
      const bucket = storage.bucket();
      let out;
      if (job.sceneKey === NEUTRAL_HANGER_SCENE_KEY) {
        out = await processNeutralHangerSceneJob(db, bucket, fetch, admin, jobId, job);
      } else if (job.sceneKey === BACKDROP_NEUTRAL_SCENE_KEY) {
        out = await processBackdropNeutralSceneJob(db, bucket, fetch, admin, jobId, job);
      } else if (job.sceneKey === BODY_MODEL_SCENE_KEY) {
        out = await processBodyModelSceneJob(db, bucket, fetch, admin, jobId, job);
      } else if (FLATLAY_SCENE_KEYS.has(job.sceneKey)) {
        out = await processFlatlaySceneJob(db, bucket, fetch, admin, jobId, job);
      } else {
        throw new Error(`Unhandled sceneKey: ${job.sceneKey}`);
      }
      await jobRef.update({
        status: "succeeded",
        output: {
          assetId: out.assetId,
          imageUrl: out.url,
          thumbUrl: out.url,
          storagePath: out.storagePath,
        },
        errorMessage: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      console.error("[onSceneRenderJobCreated] failed:", jobId, message);
      await jobRef.update({
        status: "failed",
        errorMessage: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

/**
 * Update merchandising approval on a scene asset and sync variant `sceneTemplateRenders` cache.
 */
exports.updateSceneAssetApproval = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const assetId = data && data.assetId;
  const approvalState = data && data.approvalState;
  if (!assetId || typeof assetId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "assetId is required");
  }
  const allowed = new Set(["approved", "rejected", "pending_review", "auto_approved", "needs_review"]);
  if (!approvalState || !allowed.has(String(approvalState))) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid approvalState");
  }

  const ref = db.collection("rp_product_assets").doc(assetId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Asset not found");
  }
  const row = snap.data();
  const uid = context.auth.uid;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const assetStatus =
    approvalState === "rejected" ? "rejected" : approvalState === "pending_review" || approvalState === "needs_review" ? "draft" : "approved";

  await ref.update({
    approvalState,
    status: assetStatus,
    updatedAt: now,
    updatedBy: uid,
  });

  const productId = row.productId;
  const variantDocId = row.variantDocId;
  const slug = row.sceneTemplateSlug;
  if (productId && variantDocId && slug) {
    const vRef = db.collection("rp_products").doc(productId).collection("variants").doc(variantDocId);
    const vSnap = await vRef.get();
    if (vSnap.exists) {
      const v = vSnap.data();
      const prev = v.sceneTemplateRenders && typeof v.sceneTemplateRenders === "object" ? { ...v.sceneTemplateRenders } : {};
      if (prev[slug]) {
        prev[slug] = {
          ...prev[slug],
          approvalState,
          status: approvalState === "rejected" ? "rejected" : "generated",
        };
        await vRef.update({
          sceneTemplateRenders: prev,
          updatedAt: now,
          updatedBy: uid,
        });
      }
    }
  }

  return { ok: true };
});

// ---------------------------------------------------------------------------
// Bulk Generation Jobs
// ---------------------------------------------------------------------------

const BULK_MAX_MOCK_JOBS_PER_RUN = 5;
const BULK_MAX_GENERATION_JOBS_PER_RUN = 10;

/**
 * Create a bulk generation job.
 * Validates designs (must have PNG), blanks, identities; creates job doc with status=pending.
 */
exports.createBulkGenerationJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { designIds, blankIds, identityIds, imagesPerProduct = 3, presetId } = data || {};

  if (!Array.isArray(designIds) || designIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "designIds must be a non-empty array");
  }
  if (!Array.isArray(blankIds) || blankIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "blankIds must be a non-empty array");
  }
  if (!Array.isArray(identityIds) || identityIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "identityIds must be a non-empty array");
  }

  const userId = context.auth.uid;

  for (const designId of designIds) {
    const designSnap = await db.collection("designs").doc(designId).get();
    if (!designSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
    }
    const design = designSnap.data();
    if (!designPngUrlForProcessing(design)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Design ${designId} is missing PNG overlay. Upload light/dark PNGs in Design Detail → Files.`
      );
    }
  }

  for (const blankId of blankIds) {
    const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
    if (!blankSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
    }
  }

  for (const identityId of identityIds) {
    const identitySnap = await db.collection("rp_identities").doc(identityId).get();
    if (!identitySnap.exists) {
      throw new functions.https.HttpsError("not-found", `Identity ${identityId} not found`);
    }
  }

  const total = designIds.length * blankIds.length * identityIds.length;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const jobData = {
    designIds,
    blankIds,
    identityIds,
    options: {
      imagesPerProduct: typeof imagesPerProduct === "number" ? imagesPerProduct : 3,
      presetId: presetId || null,
    },
    status: "pending",
    progress: { total, completed: 0, failed: 0 },
    productIdsByKey: {},
    generationJobsCreated: 0,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
  };

  const jobRef = await db.collection("rp_bulk_generation_jobs").add(jobData);
  const bulkJobId = jobRef.id;
  console.log("[createBulkGenerationJob] Created job:", bulkJobId, "total:", total);

  // Expand designIds × blankIds × identityIds into child job items (two-layer architecture)
  const itemsRef = db.collection("rp_bulk_generation_job_items");
  const BATCH_SIZE = 500;
  const itemDocs = [];
  for (const designId of designIds) {
    for (const blankId of blankIds) {
      for (const identityId of identityIds) {
        itemDocs.push({
          bulkJobId,
          designId,
          blankId,
          identityId,
          productId: null,
          mockJobId: null,
          generationJobId: null,
          status: "pending",
          error: null,
          attemptCount: 0,
          lastAttemptAt: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }
  for (let i = 0; i < itemDocs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = itemDocs.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      const ref = itemsRef.doc();
      batch.set(ref, item);
    }
    await batch.commit();
  }
  console.log("[createBulkGenerationJob] Created", itemDocs.length, "job items");

  return {
    ok: true,
    jobId: bulkJobId,
    total,
  };
});

/**
 * Find or create a **parent** product for designId + blankId (idempotent for bulk).
 * Matches createProductFromDesignBlank: prefers parentProductIdentityKey; creates parent + first active variant if missing.
 */
async function findOrCreateProductForBulk(designId, blankId, userId) {
  const designSnap = await db.collection("designs").doc(designId).get();
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!designSnap.exists || !blankSnap.exists) {
    throw new Error(`Design or blank not found: ${designId}, ${blankId}`);
  }
  const design = designSnap.data();
  const blank = blankSnap.data();

  let team = null;
  if (design.teamId) {
    const teamSnap = await db.collection("design_teams").doc(design.teamId).get();
    if (teamSnap.exists) {
      const teamData = teamSnap.data();
      team = {
        id: teamSnap.id,
        name: teamData.name ?? null,
        teamCode: teamData.teamCode ?? null,
        city: teamData.city ?? null,
        teamName: teamData.teamName ?? null,
        league: teamData.league ?? null,
        leagueId: teamData.leagueId ?? null,
        leagueCode: teamData.leagueCode ?? null,
        stadiumName: teamData.stadiumName ?? null,
        teamSaying: teamData.teamSaying ?? null,
        fanPhrase: teamData.fanPhrase ?? null,
        slug: teamData.slug ?? null,
      };
    }
  }

  const leagueCodeRaw = design.leagueCode || (team && (team.leagueId || team.league)) || "";
  const teamCodeRaw = design.teamCode || (team && (team.teamCode || team.id)) || design.teamId || "";
  const parentProductIdentityKey = buildParentProductIdentityKey({
    leagueCode: leagueCodeRaw,
    teamCode: teamCodeRaw,
    designId,
    blankId,
  });

  const parentSnap = await db
    .collection("rp_products")
    .where("parentProductIdentityKey", "==", parentProductIdentityKey)
    .limit(10)
    .get();
  const parentDoc = parentSnap.docs.find((d) => d.data().productKind === "parent");
  if (parentDoc) {
    return { productId: parentDoc.id };
  }

  const firstVariant =
    blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION
      ? (blank.variants || []).find((v) => v.isActive !== false)
      : null;
  const blankVariantId = firstVariant ? firstVariant.variantId : undefined;
  if (blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION && !blankVariantId) {
    throw new Error("Master blank needs at least one active variant before bulk can create a parent product.");
  }

  if (!designPngUrlForProcessing(design)) {
    throw new Error(
      "Design missing PNG overlay. Upload PNGs in Design Detail before running bulk generation for this design."
    );
  }

  try {
    const out = await runCreateProductFromDesignBlankCore({
      db,
      admin,
      functions,
      designPngUrlForProcessing,
      buildInitialRenderSetupForProduct,
      resolveBlankVariantForProduct,
      buildProductIdentityKey,
      buildParentProductIdentityKey,
      MASTER_BLANK_SCHEMA_VERSION,
      sanitizeForFirestore,
      deriveAvailableSizesFromBlank,
      deriveSizesForProductMatrix,
      merchandisingAtCreate,
      resolveBlankTemplates,
      designId,
      blankId,
      blankVariantId,
      userId: userId || "system",
    });
    try {
      if (out && out.productId && Array.isArray(out.variantIds) && out.variantIds.length > 0) {
        await startInitialProductAssetBatch({
          db,
          admin,
          sanitizeForFirestore,
          deriveSizesForProductMatrix,
          productId: out.productId,
          variantIds: out.variantIds,
          userId: userId || "system",
          force: false,
        });
      }
    } catch (assetErr) {
      console.error(
        "[findOrCreateProductForBulk] startInitialProductAssetBatch:",
        assetErr && assetErr.message ? assetErr.message : assetErr
      );
    }
    return { productId: out.productId };
  } catch (e) {
    if (e instanceof functions.https.HttpsError && e.code === "already-exists") {
      const details = e.details;
      if (details && details.productId) {
        return { productId: details.productId };
      }
    }
    throw e;
  }
}

/**
 * Scheduled worker: process pending bulk generation job items (two-layer architecture).
 * Queries rp_bulk_generation_job_items where status == "pending", creates product (idempotent),
 * mock job (once per product, throttled), or generation job (throttled). Progress is derived from items.
 */
exports.processBulkGenerationJobs = functions.pubsub
  .schedule("every 2 minutes")
  .onRun(async (context) => {
    const itemsSnap = await db.collection("rp_bulk_generation_job_items")
      .where("status", "==", "pending")
      .limit(15)
      .get();

    if (itemsSnap.empty) {
      return null;
    }

    let effectivePresetId = null;
    const presetSnap = await db.collection("rp_scene_presets")
      .where("isActive", "==", true)
      .limit(1)
      .get();
    if (!presetSnap.empty) {
      effectivePresetId = presetSnap.docs[0].id;
    }

    let mockJobsCreatedThisRun = 0;
    let genJobsCreatedThisRun = 0;
    const bulkJobIdsTouched = new Set();
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const itemDoc of itemsSnap.docs) {
      const itemRef = itemDoc.ref;
      const item = itemDoc.data();
      const { bulkJobId, designId, blankId, identityId } = item;

      if (!effectivePresetId && genJobsCreatedThisRun > 0) break;

      try {
        let jobOptions = {};
        const bulkRef = db.collection("rp_bulk_generation_jobs").doc(bulkJobId);
        const bulkSnap = await bulkRef.get();
        if (bulkSnap.exists) {
          jobOptions = bulkSnap.data().options || {};
        }
        const presetId = jobOptions.presetId || effectivePresetId;
        const imagesPerProduct = jobOptions.imagesPerProduct ?? 3;
        const createdBy = bulkSnap.exists ? bulkSnap.data().createdBy : null;

        const { productId } = await findOrCreateProductForBulk(designId, blankId, createdBy);
        await itemRef.update({
          productId,
          updatedAt: now,
        });

        const productSnap = await db.collection("rp_products").doc(productId).get();
        const product = productSnap.exists ? productSnap.data() : null;
        let hasMockup = !!(product && product.mockupUrl);
        if (
          !hasMockup &&
          product &&
          product.productKind === "parent" &&
          product.defaultVariantId &&
          typeof product.defaultVariantId === "string"
        ) {
          const vSnap = await db
            .collection("rp_products")
            .doc(productId)
            .collection("variants")
            .doc(product.defaultVariantId)
            .get();
          const v = vSnap.exists ? vSnap.data() : null;
          hasMockup = !!(v && v.mockupUrl);
        }

        if (hasMockup && presetId && genJobsCreatedThisRun < BULK_MAX_GENERATION_JOBS_PER_RUN) {
          await itemRef.update({
            status: "running",
            attemptCount: (item.attemptCount || 0) + 1,
            lastAttemptAt: now,
            updatedAt: now,
          });
          const genJobResult = await createGenerationJob({
            productId,
            presetId,
            identityId,
            generationType: "on_model",
            imageCount: imagesPerProduct,
            imageSize: "square",
          }, createdBy);
          if (genJobResult?.jobId) {
            await db.collection("rp_generation_jobs").doc(genJobResult.jobId).update({
              bulkJobId,
              updatedAt: now,
            });
            await itemRef.update({
              status: "completed",
              generationJobId: genJobResult.jobId,
              error: null,
              errorCode: null,
              errorMessage: null,
              updatedAt: now,
            });
            genJobsCreatedThisRun++;
            bulkJobIdsTouched.add(bulkJobId);
          }
        } else if (!hasMockup && mockJobsCreatedThisRun < BULK_MAX_MOCK_JOBS_PER_RUN) {
          const existingMock = await db.collection("rp_mock_jobs")
            .where("productId", "==", productId)
            .where("status", "in", ["queued", "processing"])
            .limit(1)
            .get();
          if (!existingMock.empty) {
            await itemRef.update({
              status: "awaiting_mock",
              updatedAt: now,
            });
            bulkJobIdsTouched.add(bulkJobId);
          } else {
            const designSnap = await db.collection("designs").doc(designId).get();
            const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
            const design = designSnap.exists ? designSnap.data() : {};
            const blank = blankSnap.exists ? blankSnap.data() : {};
            const dps = inferDefaultPrintSides(blank);
            const useBack = dps === "back_only";
            const placementId = useBack ? "back_center" : "front_center";
            const viewImage = useBack ? blank?.images?.back : blank?.images?.front;
            let placement = DEFAULT_MOCK_PLACEMENT;
            const blankPlacement = blank?.placements?.find(p => p.placementId === placementId);
            if (blankPlacement) {
              placement = {
                x: blankPlacement.defaultX ?? placement.x,
                y: blankPlacement.defaultY ?? placement.y,
                scale: blankPlacement.defaultScale ?? placement.scale,
                safeArea: blankPlacement.safeArea ?? placement.safeArea,
                rotationDeg: 0,
              };
            } else {
              const designPlacement = design?.placementDefaults?.find(p => p.placementId === placementId);
              if (designPlacement) {
                placement = {
                  x: designPlacement.x ?? placement.x,
                  y: designPlacement.y ?? placement.y,
                  scale: designPlacement.scale ?? placement.scale,
                  safeArea: designPlacement.safeArea ?? placement.safeArea,
                  rotationDeg: designPlacement.rotationDeg ?? 0,
                };
              }
            }
            await itemRef.update({
              status: "running",
              attemptCount: (item.attemptCount || 0) + 1,
              lastAttemptAt: now,
              updatedAt: now,
            });
            const mockRef = await db.collection("rp_mock_jobs").add({
              designId,
              blankId,
              view: useBack ? "back" : "front",
              placementId,
              quality: "draft",
              productId,
              productVariantId:
                product && product.productKind === "parent" && product.defaultVariantId
                  ? product.defaultVariantId
                  : null,
              input: {
                blankImageUrl: viewImage?.downloadUrl || null,
                designPngUrl: designPngUrlForProcessing(design) || null,
                placement,
              },
              output: {},
              attempts: 0,
              status: "queued",
              createdAt: now,
              createdByUid: createdBy,
              updatedAt: now,
            });
            await itemRef.update({
              status: "awaiting_mock",
              mockJobId: mockRef.id,
              updatedAt: now,
            });
            mockJobsCreatedThisRun++;
            bulkJobIdsTouched.add(bulkJobId);
          }
        }
      } catch (err) {
        console.warn("[processBulkGenerationJobs] Item failed:", itemDoc.id, err.message);
        await itemRef.update({
          status: "failed",
          error: err.message,
          errorMessage: err.message,
          attemptCount: (item.attemptCount || 0) + 1,
          lastAttemptAt: now,
          updatedAt: now,
        });
        bulkJobIdsTouched.add(bulkJobId);
      }
    }

    for (const bulkJobId of bulkJobIdsTouched) {
      const itemsForJob = await db.collection("rp_bulk_generation_job_items")
        .where("bulkJobId", "==", bulkJobId)
        .get();
      const total = itemsForJob.size;
      let completed = 0;
      let failed = 0;
      itemsForJob.docs.forEach(d => {
        const s = d.data().status;
        if (s === "completed") completed++;
        else if (s === "failed") failed++;
      });
      const bulkRef = db.collection("rp_bulk_generation_jobs").doc(bulkJobId);
      await bulkRef.update({
        status: completed + failed >= total ? "completed" : "running",
        progress: { total, completed, failed },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (completed + failed >= total) {
        console.log("[processBulkGenerationJobs] Bulk job completed:", bulkJobId);
      }
    }

    return null;
  });

exports.generateProductAssets = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const {
    productId,
    designId,
    generationType = "on_model", // Default to on_model for backward compatibility
    identityId,
    presetId,
    artifacts,
    promptOverrides,
    imageCount = 4,
    imageSize = "square",
    seed,
    experimentId,
    variantId,
  } = data || {};

  // Validation
  if (!productId || !presetId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "productId and presetId are required"
    );
  }

  try {
    return await generateProductAssetsImpl(data, context);
  } catch (err) {
    const msg = err?.message || String(err);
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    if (msg.includes("Identity required") || msg.includes("preset") || msg.includes("not found")) {
      throw new functions.https.HttpsError("failed-precondition", msg);
    }
    if (msg.includes("required") || msg.includes("invalid")) {
      throw new functions.https.HttpsError("invalid-argument", msg);
    }
    console.error("[generateProductAssets] Unhandled error:", err);
    throw new functions.https.HttpsError("internal", msg || "Generation failed");
  }
});

async function generateProductAssetsImpl(data, context) {
  const {
    productId,
    designId,
    generationType = "on_model",
    identityId,
    presetId,
    artifacts,
    promptOverrides,
    imageCount = 4,
    imageSize = "square",
    seed,
    experimentId,
    variantId,
  } = data || {};

  // Validate generationType
  if (generationType !== "product_only" && generationType !== "on_model") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "generationType must be 'product_only' or 'on_model'"
    );
  }

  // On-model requires identityId
  if (generationType === "on_model" && !identityId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "identityId is required for on_model generation"
    );
  }

  // Product-only must not have identity/artifacts
  if (generationType === "product_only" && (identityId || artifacts?.faceArtifactId || artifacts?.bodyArtifactId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "identityId, faceArtifactId, and bodyArtifactId are not allowed for product_only generation"
    );
  }

  console.log("[generateProductAssets] Creating job:", {
    productId,
    generationType,
    identityId: identityId || null,
    presetId,
    imageCount,
  });

  // Fetch product
  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Product not found");
  }
  const product = productSnap.data();

  // Fetch preset
  console.log("[generateProductAssets] Looking for preset with ID:", presetId);
  const presetRef = db.collection("rp_scene_presets").doc(presetId);
  const presetSnap = await presetRef.get();
  
  if (!presetSnap.exists) {
    // Try listing to see what's available for debugging
    try {
      const allPresets = await db.collection("rp_scene_presets").limit(10).get();
      console.log("[generateProductAssets] Total presets in collection:", allPresets.size);
      if (allPresets.size > 0) {
        allPresets.docs.forEach(d => {
          console.log("[generateProductAssets] Available preset:", d.id, d.data()?.name || "no name");
        });
      }
    } catch (listErr) {
      console.error("[generateProductAssets] Error querying presets:", listErr.message, listErr.code);
    }
    
    throw new functions.https.HttpsError("not-found", `Scene preset not found: ${presetId}`);
  }
  
  const preset = presetSnap.data();
  if (!preset) {
    throw new functions.https.HttpsError("not-found", `Scene preset data is empty for ID: ${presetId}`);
  }
  console.log("[generateProductAssets] Found preset:", preset.name);

  // Check if preset supports the requested generation type
  const supportedModes = preset.supportedModes || ["on_model"]; // Default to on_model for backward compatibility
  if (!supportedModes.includes(generationType)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Preset "${preset.name}" does not support generation type "${generationType}". Supported modes: ${supportedModes.join(", ")}`
    );
  }

  // Determine preset mode (use preset.mode if available, fallback to generationType)
  const presetMode = preset.mode || (generationType === "product_only" ? "productOnly" : "onModel");
  
  // Fetch identity (only for on_model)
  let identity = null;
  if (presetMode === "onModel" && identityId) {
    try {
      const identityRef = db.collection("rp_identities").doc(identityId);
      const identitySnap = await identityRef.get();
      if (identitySnap.exists) {
        identity = identitySnap.data();
      }
    } catch (err) {
      console.warn("[generateProductAssets] Could not fetch identity:", err);
    }
  }

  // Fetch artifacts if provided
  let faceArtifact = null;
  let bodyArtifact = null;
  let productArtifact = null;
  
  if (artifacts?.faceArtifactId && presetMode === "onModel") {
    try {
      const faceRef = db.collection("rp_lora_artifacts").doc(artifacts.faceArtifactId);
      const faceSnap = await faceRef.get();
      if (faceSnap.exists) {
        faceArtifact = { id: faceSnap.id, ...faceSnap.data() };
      }
    } catch (err) {
      console.warn("[generateProductAssets] Could not fetch face artifact:", err);
    }
  }
  
  if (artifacts?.bodyArtifactId && presetMode === "onModel") {
    try {
      const bodyRef = db.collection("rp_lora_artifacts").doc(artifacts.bodyArtifactId);
      const bodySnap = await bodyRef.get();
      if (bodySnap.exists) {
        bodyArtifact = { id: bodySnap.id, ...bodySnap.data() };
      }
    } catch (err) {
      console.warn("[generateProductAssets] Could not fetch body artifact:", err);
    }
  }
  
  if (artifacts?.productArtifactId || product.ai?.productArtifactId) {
    try {
      const productArtifactId = artifacts?.productArtifactId || product.ai?.productArtifactId;
      const productRef = db.collection("rp_lora_artifacts").doc(productArtifactId);
      const productSnap = await productRef.get();
      if (productSnap.exists) {
        productArtifact = { id: productSnap.id, ...productSnap.data() };
      }
    } catch (err) {
      console.warn("[generateProductAssets] Could not fetch product artifact:", err);
    }
  }

  // Resolve prompts using new guardrail resolver
  const resolved = resolvePromptWithGuardrails({
    product,
    preset,
    identity,
    faceArtifact,
    bodyArtifact,
    productArtifact,
    faceScale: artifacts?.faceScale,
    bodyScale: artifacts?.bodyScale,
    productScale: artifacts?.productScale,
    generationType, // for backward compatibility mode detection
    additionalPrompt: promptOverrides?.prompt,
    additionalNegativePrompt: promptOverrides?.negativePrompt,
  });
  
  const { prompt: resolvedPrompt, negativePrompt: resolvedNegativePrompt, loras: resolvedLoras, trace: resolverTrace } = resolved;
  
  // Combine baseline negative prompt with resolved negative prompt
  const finalNegativePrompt = [
    BASELINE_NEGATIVE_PROMPT,
    resolvedNegativePrompt || ""
  ].filter(Boolean).join(", ");

  // Merge artifact scales (only for on_model)
  const finalArtifacts = generationType === "on_model" ? {
    faceArtifactId: artifacts?.faceArtifactId || null,
    faceScale: artifacts?.faceScale ?? preset.defaults?.faceScale ?? 0.75,
    bodyArtifactId: artifacts?.bodyArtifactId || null,
    bodyScale: artifacts?.bodyScale ?? preset.defaults?.bodyScale ?? 0.6,
    productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
    productScale: artifacts?.productScale ?? preset.defaults?.productScale ?? product.ai?.productRecommendedScale ?? 0.9,
  } : {
    productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
    productScale: artifacts?.productScale ?? preset.defaults?.productScale ?? product.ai?.productRecommendedScale ?? 0.9,
  };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;

  // Product-only requires a mockup (input image)
  if (generationType === "product_only" && !product.mockupUrl) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Product must have a mockup before generating product-only images. Run \"Generate mockup\" first."
    );
  }

  // Create generation job with resolved values and trace (Section 4.1)
  const jobData = {
    productId,
    productSlug: product.slug || null, // NEW: snapshot
    designId: designId || null,
    inputImageUrl: product.mockupUrl || null, // for product_only and on_model (mockup → model)
    generationType, // Legacy, kept for backward compatibility
    presetMode, // NEW: snapshot of preset mode
    presetId,
    identityId: presetMode === "onModel" ? identityId : null,
    faceArtifactId: presetMode === "onModel" ? (artifacts?.faceArtifactId || null) : null,
    bodyArtifactId: presetMode === "onModel" ? (artifacts?.bodyArtifactId || null) : null,
    productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
    faceScale: presetMode === "onModel" ? (artifacts?.faceScale ?? preset.defaultFaceScale ?? preset.defaults?.faceScale ?? 0.80) : null,
    bodyScale: presetMode === "onModel" ? (artifacts?.bodyScale ?? preset.defaultBodyScale ?? preset.defaults?.bodyScale ?? 0.60) : null,
    productScale: artifacts?.productScale ?? preset.defaultProductScale ?? preset.defaults?.productScale ?? product.ai?.productRecommendedScale ?? 0.90,
    imageCount: imageCount ?? preset.defaultImageCount ?? preset.defaults?.imageCount ?? 4,
    size: imageSize,
    seed: seed || preset.defaultSeed || null,
    // NEW: Final resolved values saved for postmortem/debug
    resolvedPrompt,
    resolvedNegativePrompt: finalNegativePrompt,
    resolvedLoras,
    resolverTrace,
    // Legacy fields (kept for backward compatibility)
    prompt: resolvedPrompt,
    negativePrompt: finalNegativePrompt,
    artifacts: finalArtifacts,
    provider: "fal",
    endpoint: "fal-ai/flux-lora",
    params: {
      imageCount: imageCount ?? preset.defaultImageCount ?? preset.defaults?.imageCount ?? 4,
      size: imageSize,
      seed: seed || preset.defaultSeed || null,
    },
    // A/B Testing
    experimentId: experimentId || null,
    variantId: variantId || null,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  // Calculate cost estimate
  const finalImageCount = imageCount ?? preset.defaultImageCount ?? preset.defaults?.imageCount ?? 4;
  const loraCount = [
    artifacts?.faceArtifactId,
    artifacts?.bodyArtifactId,
    artifacts?.productArtifactId,
  ].filter(Boolean).length;
  
  const costEstimate = estimateGenerationCost(finalImageCount, imageSize, loraCount);
  jobData.costEstimate = costEstimate;
  jobData.costCurrency = "USD";
  jobData.retryCount = 0;
  jobData.maxRetries = 3;

  const sanitized = sanitizeForFirestore(jobData);
  const jobRef = await db.collection("rp_generation_jobs").add(sanitized);

  console.log("[generateProductAssets] Created job:", jobRef.id, `(estimated cost: $${costEstimate.toFixed(4)})`);

  return {
    ok: true,
    jobId: jobRef.id,
    costEstimate,
  };
}

/**
 * Batch Generate Product Assets
 * Creates multiple generation jobs for multiple products
 */
exports.batchGenerateProductAssets = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const { requests, batchName } = data;

  if (!Array.isArray(requests) || requests.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "requests must be a non-empty array");
  }

  if (requests.length > 50) {
    throw new functions.https.HttpsError("invalid-argument", "Maximum 50 requests per batch");
  }

  // Validate each request
  for (const req of requests) {
    if (!req.productId || !req.presetId) {
      throw new functions.https.HttpsError("invalid-argument", "Each request must have productId and presetId");
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batchJobRef = db.collection("rp_batch_jobs").doc();
  const batchJobId = batchJobRef.id;

  // Create batch job record
  await batchJobRef.set({
    name: batchName || `Batch ${new Date().toISOString()}`,
    status: "processing",
    totalRequests: requests.length,
    completedRequests: 0,
    failedRequests: 0,
    jobIds: [],
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  });

  const jobIds = [];
  const errors = [];

  // Process each request sequentially to avoid overwhelming the system
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    try {
      // Create generation job using helper function
      const result = await createGenerationJob({
        productId: req.productId,
        presetId: req.presetId,
        identityId: req.identityId,
        designId: req.designId,
        generationType: req.generationType || "on_model",
        artifacts: req.artifacts,
        promptOverrides: req.promptOverrides,
        imageCount: req.imageCount || 4,
        imageSize: req.size || "square",
        seed: req.seed,
      }, userId);

      if (result?.jobId) {
        jobIds.push(result.jobId);
      }
    } catch (error) {
      console.error(`[batchGenerateProductAssets] Error processing request ${i + 1}:`, error);
      errors.push({
        index: i,
        request: req,
        error: error.message || "Unknown error",
      });
    }

    // Update batch job progress
    await batchJobRef.update({
      completedRequests: i + 1,
      failedRequests: errors.length,
      jobIds,
      updatedAt: now,
    });

    // Small delay between requests to avoid rate limits
    if (i < requests.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Mark batch as completed
  await batchJobRef.update({
    status: errors.length === 0 ? "completed" : "completed_with_errors",
    updatedAt: now,
  });

  return {
    ok: true,
    batchJobId,
    totalRequests: requests.length,
    successfulJobs: jobIds.length,
    failedJobs: errors.length,
    jobIds,
    errors: errors.length > 0 ? errors : undefined,
  };
});

/**
 * Worker: Process generation jobs (calls fal.ai to generate real images)
 * This is triggered when a job is created with status "queued"
 */
exports.onRpGenerationJobCreated = functions.firestore
  .document("rp_generation_jobs/{jobId}")
  .onCreate(async (snap, context) => {
    const job = snap.data();
    const jobId = context.params.jobId;

    // Only process queued jobs
    if (job.status !== "queued") {
      console.log(`[onRpGenerationJobCreated] Job ${jobId} not queued, skipping`);
      return;
    }

    console.log(`[onRpGenerationJobCreated] Processing job ${jobId}`);

    const jobRef = db.collection("rp_generation_jobs").doc(jobId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const FAL_API_KEY = getFalApiKey();
    const USE_PLACEHOLDER = usePlaceholderWorker();

    try {
      // Load related documents for debug logging
      const [productSnap, presetSnap, identitySnap] = await Promise.all([
        job.productId ? db.collection("rp_products").doc(job.productId).get().catch(() => null) : Promise.resolve(null),
        job.presetId ? db.collection("rp_scene_presets").doc(job.presetId).get().catch(() => null) : Promise.resolve(null),
        job.identityId ? db.collection("rp_identities").doc(job.identityId).get().catch(() => null) : Promise.resolve(null),
      ]);

      const product = productSnap?.exists ? productSnap.data() : null;
      const preset = presetSnap?.exists ? presetSnap.data() : null;
      const identity = identitySnap?.exists ? identitySnap.data() : null;

      // Resolve LoRA artifacts and build debug info
      const generationType = job.generationType || "on_model"; // Default to on_model for backward compatibility
      const resolvedLoras = [];
      const debugInfo = {
        generationType,
        resolvedPrompt: job.prompt || null,
        negativePrompt: job.negativePrompt || null,
        identityTrigger: generationType === "on_model" ? (identity?.trigger || identity?.defaultTriggerPhrase || job.identityId) : null,
        productKey: product?.slug || product?.name || null,
        inputImageUrl: job.inputImageUrl || product?.mockupUrl || null,
        scenePresetId: job.presetId || null,
        scenePresetName: preset?.name || null,
        faceArtifactId: generationType === "on_model" ? (job.artifacts?.faceArtifactId || null) : null,
        faceScale: generationType === "on_model" ? (job.artifacts?.faceScale || null) : null,
        bodyArtifactId: generationType === "on_model" ? (job.artifacts?.bodyArtifactId || null) : null,
        bodyScale: generationType === "on_model" ? (job.artifacts?.bodyScale || null) : null,
        productArtifactId: job.artifacts?.productArtifactId || null,
        productScale: job.artifacts?.productScale || null,
        imageSize: job.params?.size || "square",
        imageCount: job.params?.imageCount || 4,
        seed: job.params?.seed || null,
        usePlaceholderWorker: USE_PLACEHOLDER,
      };
      
      // Only resolve face/body artifacts for on_model mode
      if (generationType === "on_model" && job.artifacts?.faceArtifactId) {
        try {
          const faceArtifactRef = db.collection("rp_lora_artifacts").doc(job.artifacts.faceArtifactId);
          const faceArtifactSnap = await faceArtifactRef.get();
          if (faceArtifactSnap.exists) {
            const faceArtifact = faceArtifactSnap.data();
            resolvedLoras.push({
              weightsUrl: faceArtifact.weightsUrl,
              scale: job.artifacts.faceScale || 0.75,
            });
            debugInfo.faceArtifactUrl = faceArtifact.weightsUrl;
          }
        } catch (e) {
          console.warn(`[onRpGenerationJobCreated] Failed to load face artifact:`, e);
        }
      }

      // Only resolve face/body artifacts for on_model mode
      if (generationType === "on_model" && job.artifacts?.bodyArtifactId) {
        try {
          const bodyArtifactRef = db.collection("rp_lora_artifacts").doc(job.artifacts.bodyArtifactId);
          const bodyArtifactSnap = await bodyArtifactRef.get();
          if (bodyArtifactSnap.exists) {
            const bodyArtifact = bodyArtifactSnap.data();
            resolvedLoras.push({
              weightsUrl: bodyArtifact.weightsUrl,
              scale: job.artifacts.bodyScale || 0.6,
            });
            debugInfo.bodyArtifactUrl = bodyArtifact.weightsUrl;
          }
        } catch (e) {
          console.warn(`[onRpGenerationJobCreated] Failed to load body artifact:`, e);
        }
      }

      if (job.artifacts?.productArtifactId) {
        try {
          const productArtifactRef = db.collection("rp_lora_artifacts").doc(job.artifacts.productArtifactId);
          const productArtifactSnap = await productArtifactRef.get();
          if (productArtifactSnap.exists) {
            const productArtifact = productArtifactSnap.data();
            resolvedLoras.push({
              weightsUrl: productArtifact.weightsUrl,
              scale: job.artifacts.productScale || 0.9,
            });
            debugInfo.productArtifactUrl = productArtifact.weightsUrl;
          }
        } catch (e) {
          console.warn(`[onRpGenerationJobCreated] Failed to load product artifact:`, e);
        }
      }

      // Combine baseline negative prompt with job-specific negative prompt
      const finalNegativePrompt = [
        BASELINE_NEGATIVE_PROMPT,
        job.negativePrompt || ""
      ].filter(Boolean).join(", ");
      debugInfo.finalNegativePrompt = finalNegativePrompt;

      // Update job with debug info and status to running
      await jobRef.update({
        status: "running",
        debug: debugInfo,
        updatedAt: now,
      });

      // PRODUCT_ONLY: Exact composite path — use mockup as-is (deterministic), no generative model.
      // Official catalog flat roles (initialAssetRole) use product_only + Fal packshot prompts instead.
      if (generationType === "product_only" && !job.initialAssetRole) {
        const mockupUrl = job.inputImageUrl || product?.mockupUrl || null;
        if (!mockupUrl) {
          throw new Error("product_only job requires inputImageUrl (product mockup). Generate mockup first.");
        }
        console.log(`[onRpGenerationJobCreated] product_only: using exact composite from mockup (no generative pass)`);

        const imageResponse = await fetch(mockupUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch mockup image: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        const contentType = imageResponse.headers.get("content-type") || "image/png";
        const buffer = Buffer.from(await imageResponse.arrayBuffer());

        const bucket = storage.bucket();
        const assetPath = `rp/products/${job.productId}/assets/${jobId}_0.png`;
        const file = bucket.file(assetPath);
        await file.save(buffer, { contentType });
        await file.makePublic();
        const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${assetPath}`;

        const presetMode = "productOnly";
        const assetType = "productPackshot";
        const assetData = {
          productId: job.productId,
          jobId: jobId,
          designId: job.designId || null,
          presetId: job.presetId,
          presetMode,
          assetType,
          generationType: "product_only",
          identityId: null,
          type: "image",
          status: "draft",
          storagePath: assetPath,
          downloadUrl,
          publicUrl: downloadUrl,
          generationJobId: jobId,
          prompt: job.resolvedPrompt || job.prompt || null,
          negativePrompt: job.negativePrompt || null,
          artifacts: job.artifacts || null,
          source: "exact_composite",
          createdAt: now,
          updatedAt: now,
          createdBy: job.createdBy || "system",
          updatedBy: "system",
        };
        const sanitizedAsset = Object.fromEntries(
          Object.entries(assetData).filter(([_, value]) => value !== undefined)
        );
        const assetRef = await db.collection("rp_product_assets").add(sanitizedAsset);
        const assetRefs = [{ assetId: assetRef.id, storagePath: assetPath, downloadUrl }];

        await jobRef.update({
          status: "succeeded",
          outputs: { images: assetRefs },
          actualCost: 0,
          updatedAt: now,
        });
        const productRef = db.collection("rp_products").doc(job.productId);
        await productRef.update({
          "counters.assetsTotal": admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });
        console.log(`[onRpGenerationJobCreated] product_only job ${jobId} completed: 1 exact-composite asset`);
        return;
      }

      // PLACEHOLDER MODE: Create placeholder assets and return
      if (USE_PLACEHOLDER) {
        console.log(`[onRpGenerationJobCreated] Using PLACEHOLDER worker mode (job ${jobId})`);
        
        const imageCount = job.params?.imageCount || 4;
        const placeholderUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'%3E%3Crect fill='%23e5e7eb' width='1024' height='1024'/%3E%3Ctext x='50%25' y='50%25' font-family='Arial' font-size='24' fill='%23666666' text-anchor='middle' dominant-baseline='middle'%3EGenerated Image%3C/text%3E%3C/svg%3E";
        
        const assetRefs = [];
        for (let i = 0; i < imageCount; i++) {
          const assetPath = `rp/products/${job.productId}/assets/${jobId}_${i}.png`;
          // Determine asset type and preset mode
          const presetMode = job.presetMode || (job.generationType === "product_only" ? "productOnly" : "onModel");
          const assetType = presetMode === "productOnly" ? "productPackshot" : "onModelImage";
          
          const assetData = {
            productId: job.productId,
            jobId: jobId, // NEW: use jobId instead of generationJobId
            designId: job.designId || null,
            presetId: job.presetId,
            presetMode, // NEW: snapshot
            assetType, // NEW: type/intent
            generationType: job.generationType || "on_model", // Legacy, kept for backward compatibility
            identityId: job.identityId || null,
            type: "image", // Legacy, kept for backward compatibility
            status: "draft",
            storagePath: assetPath,
            downloadUrl: placeholderUrl,
            generationJobId: jobId, // Legacy, kept for backward compatibility
            prompt: job.resolvedPrompt || job.prompt || null, // Use resolvedPrompt if available
            negativePrompt: finalNegativePrompt,
            artifacts: job.artifacts || null,
            createdAt: now,
            updatedAt: now,
            createdBy: job.createdBy || "system",
            updatedBy: "system",
          };

          const sanitized = Object.fromEntries(
            Object.entries(assetData).filter(([_, value]) => value !== undefined)
          );

          const assetRef = await db.collection("rp_product_assets").add(sanitized);
          assetRefs.push({
            assetId: assetRef.id,
            storagePath: assetPath,
            downloadUrl: placeholderUrl,
          });
        }

        await jobRef.update({
          status: "succeeded",
          outputs: { images: assetRefs },
          updatedAt: now,
        });

        const productRef = db.collection("rp_products").doc(job.productId);
        await productRef.update({
          "counters.assetsTotal": admin.firestore.FieldValue.increment(imageCount),
          updatedAt: now,
        });

        console.log(`[onRpGenerationJobCreated] Job ${jobId} completed with placeholders`);
        return;
      }

      // REAL MODE: Continue with fal.ai generation
      // For product_only, we only need product artifact (optional, can generate without LoRA)
      // For on_model, we need at least one artifact (face, body, or product)
      if (generationType === "on_model" && resolvedLoras.length === 0) {
        throw new Error("No valid LoRA artifacts found. At least one artifact (face, body, or product) is required for on_model generation.");
      }
      // For product_only, LoRAs are optional (can generate without any LoRA)

      // Map imageSize to fal.ai preset
      let imageSizePreset = "square";
      const imageSize = job.params?.size || "square";
      if (typeof imageSize === "string") {
        if (imageSize === "square") imageSizePreset = "square_hd";
        else if (imageSize === "portrait") imageSizePreset = "portrait_16_9";
        else if (imageSize === "landscape") imageSizePreset = "landscape_16_9";
      }

      // Build fal.ai payload with combined negative prompt
      const falPayload = {
        prompt: job.prompt,
        num_images: job.params?.imageCount || 4,
        image_size: imageSizePreset,
        negative_prompt: finalNegativePrompt,
        ...(job.params?.seed && { seed: job.params.seed }),
      };

      // Add LoRA URLs and scales (only if we have LoRAs)
      if (resolvedLoras.length > 0) {
        if (resolvedLoras.length === 1) {
          falPayload.lora_url = resolvedLoras[0].weightsUrl;
          falPayload.lora_scale = resolvedLoras[0].scale;
        } else {
          falPayload.lora_urls = resolvedLoras.map(l => l.weightsUrl);
          falPayload.lora_scales = resolvedLoras.map(l => l.scale);
        }
      }
      // For product_only without product LoRA, we generate with prompt only (no LoRA)

      let resultImageUrls = [];
      let falRequestId = `job-${jobId}-${Date.now()}`;
      let falResponseMeta = {};

      // REAL MODE: Call fal.ai API
      if (!FAL_API_KEY) {
        throw new Error("FAL_API_KEY not set. Real generation requires API key configuration.");
      }

      console.log(`[onRpGenerationJobCreated] Using REAL worker mode (job ${jobId})`);
      console.log(`[onRpGenerationJobCreated] Debug info written to job doc - check Firestore for prompt/artifacts`);
      const url = resolveFalUrl("fal-ai/flux-lora");
      console.log(`[onRpGenerationJobCreated] Calling fal.ai: ${url}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${FAL_API_KEY}`,
        },
        body: JSON.stringify(falPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`fal.ai API error (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      falRequestId = json.request_id || json.id || falRequestId;
      falResponseMeta = json;

      // Poll for completion
      if (json.status === "IN_QUEUE" || json.status === "IN_PROGRESS") {
        const statusUrl = json.status_url || `${url}/requests/${falRequestId}/status`;
        const maxAttempts = 120; // 10 minutes max (5 second intervals)
        let attempts = 0;
        let completed = false;

        while (!completed && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          attempts++;

          try {
            const statusResponse = await fetch(statusUrl, {
              headers: { Authorization: `Key ${FAL_API_KEY}` },
            });

            if (statusResponse.ok) {
              const statusJson = await statusResponse.json();
              console.log(`[onRpGenerationJobCreated] Status check ${attempts}: ${statusJson.status}`);

              if (statusJson.status === "COMPLETED") {
                completed = true;
                const responseUrl = json.response_url || `${url}/requests/${falRequestId}`;
                const resultResponse = await fetch(responseUrl, {
                  headers: { Authorization: `Key ${FAL_API_KEY}` },
                });

                if (resultResponse.ok) {
                  const resultJson = await resultResponse.json();
                  const urlsFromJson = resultJson.images || resultJson.resultImageUrls || resultJson.outputs || resultJson.output || [];
                  
                  if (Array.isArray(urlsFromJson)) {
                    resultImageUrls = urlsFromJson
                      .map((item) => typeof item === "string" ? item : item.url || item.image_url)
                      .filter(Boolean);
                  }

                  if (!resultImageUrls.length && resultJson.url) {
                    resultImageUrls = [resultJson.url];
                  }

                  falResponseMeta = { ...falResponseMeta, ...resultJson };
                }
              } else if (statusJson.status === "FAILED") {
                throw new Error(`fal.ai request failed: ${statusJson.error || "Unknown error"}`);
              }
            }
          } catch (pollError) {
            console.error(`[onRpGenerationJobCreated] Error polling status:`, pollError);
          }
        }

        if (!completed) {
          throw new Error("fal.ai request timed out after polling");
        }
      } else if (json.status === "COMPLETED") {
        // Already completed
        const urlsFromJson = json.images || json.resultImageUrls || json.outputs || json.output || [];
        if (Array.isArray(urlsFromJson)) {
          resultImageUrls = urlsFromJson
            .map((item) => typeof item === "string" ? item : item.url || item.image_url)
            .filter(Boolean);
        }
        if (!resultImageUrls.length && json.url) {
          resultImageUrls = [json.url];
        }
      }

      if (resultImageUrls.length === 0) {
        throw new Error("No images returned from fal.ai");
      }

      console.log(`[onRpGenerationJobCreated] Got ${resultImageUrls.length} images from fal.ai`);

      // Download images and upload to Firebase Storage
      const bucket = storage.bucket();
      const assetRefs = [];

      for (let i = 0; i < resultImageUrls.length; i++) {
        const imageUrl = resultImageUrls[i];
        const assetPath = `rp/products/${job.productId}/assets/${jobId}_${i}.png`;

        try {
          // Download image from fal.ai
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            throw new Error(`Failed to download image ${i}: ${imageResponse.statusText}`);
          }

          const contentType = imageResponse.headers.get("content-type") || "image/png";
          const buffer = Buffer.from(await imageResponse.arrayBuffer());

          // Calculate image hash for duplicate detection
          const imageHash = crypto.createHash("sha256").update(buffer).digest("hex");

          // Check for similar assets (exact hash match)
          const similarAssetsQuery = await db.collection("rp_product_assets")
            .where("imageHash", "==", imageHash)
            .limit(5)
            .get();
          
          const similarAssetIds = similarAssetsQuery.docs.map((d) => d.id);

          // Upload to Firebase Storage
          const file = bucket.file(assetPath);
          await file.save(buffer, { contentType });
          await file.makePublic();

          const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${assetPath}`;

          // Create asset document
          // Determine asset type and preset mode
          const presetMode = job.presetMode || (job.generationType === "product_only" ? "productOnly" : "onModel");
          const assetType = presetMode === "productOnly" ? "productPackshot" : "onModelImage";
          
          const assetData = {
            productId: job.productId,
            jobId: jobId, // NEW: use jobId instead of generationJobId
            designId: job.designId || null,
            presetId: job.presetId,
            presetMode, // NEW: snapshot
            assetType, // NEW: type/intent
            generationType: job.generationType || "on_model", // Legacy, kept for backward compatibility
            identityId: job.identityId || null,
            type: "image", // Legacy, kept for backward compatibility
            status: "draft",
            storagePath: assetPath,
            downloadUrl,
            publicUrl: downloadUrl, // NEW: alias
            generationJobId: jobId, // Legacy, kept for backward compatibility
            prompt: job.resolvedPrompt || job.prompt || null, // Use resolvedPrompt if available
            negativePrompt: finalNegativePrompt,
            artifacts: job.artifacts || null,
            falRequestId,
            // NEW: Deduplication
            imageHash,
            similarAssetIds: similarAssetIds.length > 0 ? similarAssetIds : undefined,
            createdAt: now,
            updatedAt: now,
            createdBy: job.createdBy || "system",
            updatedBy: "system",
          };

          const sanitized = Object.fromEntries(
            Object.entries(assetData).filter(([_, value]) => value !== undefined)
          );

          const assetRef = await db.collection("rp_product_assets").add(sanitized);
          assetRefs.push({
            assetId: assetRef.id,
            storagePath: assetPath,
            downloadUrl,
          });

          console.log(`[onRpGenerationJobCreated] Created asset ${i + 1}/${resultImageUrls.length}: ${assetRef.id}`);
        } catch (imageError) {
          console.error(`[onRpGenerationJobCreated] Failed to process image ${i}:`, imageError);
          // Continue with other images even if one fails
        }
      }

      if (assetRefs.length === 0) {
        throw new Error("Failed to create any assets");
      }

      // Calculate actual cost (use estimate for now, could be enhanced with actual API response)
      const actualCost = job.costEstimate || estimateGenerationCost(
        job.params?.imageCount || 4,
        job.params?.size || "square",
        resolvedLoras.length
      );

      // Update job with outputs and mark as succeeded
      await jobRef.update({
        status: "succeeded",
        outputs: { images: assetRefs },
        falRequestId,
        falResponseMeta,
        actualCost,
        updatedAt: now,
      });

      // Update product counters
      const productRef = db.collection("rp_products").doc(job.productId);
      await productRef.update({
        "counters.assetsTotal": admin.firestore.FieldValue.increment(assetRefs.length),
        updatedAt: now,
      });

      console.log(`[onRpGenerationJobCreated] Job ${jobId} completed, created ${assetRefs.length} assets`);
    } catch (error) {
      console.error(`[onRpGenerationJobCreated] Error processing job ${jobId}:`, error);
      
      const retryCount = (job.retryCount || 0) + 1;
      const maxRetries = job.maxRetries || 3;
      const shouldRetry = retryCount < maxRetries && isRetryableError(error);
      
      if (shouldRetry) {
        console.log(`[onRpGenerationJobCreated] Retrying job ${jobId} (attempt ${retryCount}/${maxRetries})`);
        // Schedule retry by updating status back to queued after a delay
        await jobRef.update({
          status: "queued",
          retryCount,
          lastRetryAt: now,
          lastError: {
            message: error.message,
            code: error.code,
            retryable: true,
          },
          updatedAt: now,
        });
      } else {
        // Mark as failed permanently
        await jobRef.update({
          status: "failed",
          retryCount,
          lastError: {
            message: error.message,
            code: error.code,
            retryable: false,
          },
          updatedAt: now,
        });
      }
    }
  });

// Helper: Determine if error is retryable
function isRetryableError(error) {
  // Retry on network errors, rate limits, timeouts
  const retryableCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "429", "503", "502"];
  const retryableMessages = ["timeout", "rate limit", "network", "temporary"];
  
  if (error.code && retryableCodes.includes(String(error.code))) return true;
  if (error.message) {
    const msg = error.message.toLowerCase();
    if (retryableMessages.some(keyword => msg.includes(keyword))) return true;
  }
  
  return false;
}

/**
 * Notification System: Trigger on generation job status changes
 * Creates notifications when jobs complete or fail
 */
exports.onRpGenerationJobStatusChanged = functions.firestore
  .document("rp_generation_jobs/{jobId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const jobId = context.params.jobId;

    // Only process if status actually changed
    if (before.status === after.status) {
      return;
    }

    try {
      const {
        handleOfficialGenerationJobTerminal,
        handleOfficialGenerationJobRunning,
      } = require("./lib/officialProductImageJobs");
      /**
       * Phase K2: surface the queued→running transition to the batch UI so
       * the dashboard drawer shows live motion during the 30–60s render.
       * Best-effort + separate try so a running-mark hiccup never blocks the
       * terminal handler (which writes the actual image result).
       */
      try {
        await handleOfficialGenerationJobRunning({
          db,
          admin,
          sanitizeForFirestore,
          before,
          after,
          jobId,
        });
      } catch (runErr) {
        console.warn(
          "[onRpGenerationJobStatusChanged] running-mark hook:",
          runErr && runErr.message ? runErr.message : runErr
        );
      }
      await handleOfficialGenerationJobTerminal({
        db,
        admin,
        sanitizeForFirestore,
        before,
        after,
        jobId,
      });
    } catch (e) {
      console.warn(
        "[onRpGenerationJobStatusChanged] official asset batch hook:",
        e && e.message ? e.message : e
      );
    }

    const userId = after.createdBy;
    if (!userId) {
      console.log(`[onRpGenerationJobStatusChanged] Job ${jobId} has no createdBy, skipping notification`);
      return;
    }

    // Check user notification preferences
    const userPrefsRef = db.collection("rp_notification_preferences").doc(userId);
    const userPrefsSnap = await userPrefsRef.get();
    const userPrefs = userPrefsSnap.exists ? userPrefsSnap.data() : null;

    // Default preferences if not set
    const emailEnabled = userPrefs?.emailEnabled ?? false;
    const inAppEnabled = userPrefs?.inAppEnabled ?? true; // Default to true for in-app
    const typeEnabled = userPrefs?.types || {};

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Create notification based on status change
    if (after.status === "succeeded" || after.status === "completed") {
      const notifyType = "generation_complete";
      if (inAppEnabled && (typeEnabled[notifyType] !== false)) {
        const productSnap = await db.collection("rp_products").doc(after.productId).get();
        const product = productSnap.exists ? productSnap.data() : null;
        const productName = product?.name || after.productSlug || "Unknown Product";

        await db.collection("rp_notifications").add({
          userId,
          type: notifyType,
          title: "Generation Complete",
          message: `Generated ${after.outputs?.images?.length || 0} asset(s) for ${productName}`,
          relatedJobId: jobId,
          relatedProductId: after.productId,
          read: false,
          createdAt: now,
        });
        console.log(`[onRpGenerationJobStatusChanged] Created completion notification for job ${jobId}`);
      }
    } else if (after.status === "failed") {
      const notifyType = "generation_failed";
      if (inAppEnabled && (typeEnabled[notifyType] !== false)) {
        const productSnap = await db.collection("rp_products").doc(after.productId).get();
        const product = productSnap.exists ? productSnap.data() : null;
        const productName = product?.name || after.productSlug || "Unknown Product";
        const errorMsg = after.lastError?.message || "Unknown error";

        await db.collection("rp_notifications").add({
          userId,
          type: notifyType,
          title: "Generation Failed",
          message: `Failed to generate assets for ${productName}: ${errorMsg}`,
          relatedJobId: jobId,
          relatedProductId: after.productId,
          read: false,
          createdAt: now,
        });
        console.log(`[onRpGenerationJobStatusChanged] Created failure notification for job ${jobId}`);
      }
    }

    // Handle bulk generation job progress (legacy: only when job has no child items; item-based jobs use worker-derived progress)
    if (after.bulkJobId) {
      const hasItems = await db.collection("rp_bulk_generation_job_items")
        .where("bulkJobId", "==", after.bulkJobId)
        .limit(1)
        .get();
      if (hasItems.empty) {
        const bulkRef = db.collection("rp_bulk_generation_jobs").doc(after.bulkJobId);
        const bulkSnap = await bulkRef.get();
        if (bulkSnap.exists) {
          const bulk = bulkSnap.data();
          const progress = bulk.progress || { total: 0, completed: 0, failed: 0 };
          const isSuccess = after.status === "succeeded" || after.status === "completed";
          const update = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (isSuccess) {
            update["progress.completed"] = (progress.completed || 0) + 1;
          } else if (after.status === "failed") {
            update["progress.failed"] = (progress.failed || 0) + 1;
          }
          await bulkRef.update(update);

          const newCompleted = isSuccess ? (progress.completed || 0) + 1 : (progress.completed || 0);
          const newFailed = after.status === "failed" ? (progress.failed || 0) + 1 : (progress.failed || 0);
          if (newCompleted + newFailed >= (progress.total || 0)) {
            await bulkRef.update({
              status: "completed",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log("[onRpGenerationJobStatusChanged] Bulk job completed:", after.bulkJobId);
          }
        }
      }
    }

    // Handle batch job completion
    if (after.batchJobId) {
      // Check if batch job is complete
      const batchJobRef = db.collection("rp_batch_jobs").doc(after.batchJobId);
      const batchJobSnap = await batchJobRef.get();
      if (batchJobSnap.exists) {
        const batchJob = batchJobSnap.data();
        if (batchJob.status === "completed" || batchJob.status === "completed_with_errors") {
          // Check if we already notified for this batch
          const existingNotify = await db.collection("rp_notifications")
            .where("userId", "==", userId)
            .where("type", "==", "batch_complete")
            .where("relatedJobId", "==", after.batchJobId)
            .limit(1)
            .get();

          if (existingNotify.empty && inAppEnabled && (typeEnabled.batch_complete !== false)) {
            await db.collection("rp_notifications").add({
              userId,
              type: "batch_complete",
              title: "Batch Generation Complete",
              message: `Batch "${batchJob.name}" completed: ${batchJob.successfulJobs || 0} successful, ${batchJob.failedRequests || 0} failed`,
              relatedJobId: after.batchJobId,
              read: false,
              createdAt: now,
            });
            console.log(`[onRpGenerationJobStatusChanged] Created batch completion notification for batch ${after.batchJobId}`);
          }
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// ProductDesign + AI Design Brief System Functions
// ---------------------------------------------------------------------------

/**
 * Helper: Generate designKey from name (for versioning)
 */
function generateDesignKey(name) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Helper: Validate hex color format
 */
function isValidHexColor(hex) {
  if (!hex) return true; // Optional
  return /^#([A-Fa-f0-9]{6})$/.test(hex);
}

/**
 * Helper: Get next version for a designKey + productId
 */
async function getNextVersion(db, productId, designKey) {
  const designsRef = db.collection("rp_product_designs");
  const snapshot = await designsRef
    .where("productId", "==", productId)
    .where("designKey", "==", designKey)
    .orderBy("version", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return 1;
  }

  const latestVersion = snapshot.docs[0].data().version || 0;
  return latestVersion + 1;
}

/**
 * Create a new ProductDesign with auto-versioning
 * 
 * Requirements:
 * - Auto-versioning per {productId + designKey}
 * - Immutability: approved designs cannot be updated (must create new version)
 * - Validation: inkColors.length <= maxInkColors, hex format, placement enum
 */
exports.createProductDesign = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const {
    productId,
    designKey,
    name,
    description,
    inkColors,
    printMethod,
    maxInkColors,
    placement,
    placementNotes,
    sizeSpec,
    textElements,
    styleTags,
    briefId,
    existingDesignId, // If provided, check immutability
  } = data || {};

  if (!productId || !name || !printMethod || !placement) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "productId, name, printMethod, and placement are required"
    );
  }

  console.log("[createProductDesign] Creating design:", { productId, name, designKey });

  // Validate inkColors
  if (!inkColors || !Array.isArray(inkColors) || inkColors.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "inkColors array is required"
    );
  }

  // Check maxInkColors constraint
  if (maxInkColors && inkColors.length > maxInkColors) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Too many ink colors (${inkColors.length}). Maximum allowed: ${maxInkColors}`
    );
  }

  // Validate hex colors
  for (const ink of inkColors) {
    if (ink.hex && !isValidHexColor(ink.hex)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid hex color format: ${ink.hex}. Expected format: #RRGGBB`
      );
    }
  }

  // If editing an existing design, check immutability
  if (existingDesignId) {
    const existingRef = db.collection("rp_product_designs").doc(existingDesignId);
    const existingSnap = await existingRef.get();
    
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      if (existing.status === "approved") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Cannot update an approved design. Create a new version instead."
        );
      }
    }
  }

  // Generate designKey if not provided
  const finalDesignKey = designKey || generateDesignKey(name);

  // Get next version
  const version = await getNextVersion(db, productId, finalDesignKey);

  // Generate slug
  const slug = `${finalDesignKey.toLowerCase().replace(/_/g, "-")}-v${version}`;
  
  // Generate code (if not provided)
  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  const product = productSnap.exists ? productSnap.data() : null;
  const code = product?.baseProductKey 
    ? `${product.baseProductKey}_${finalDesignKey}_${String.fromCharCode(64 + version)}`
    : `${finalDesignKey}_${String.fromCharCode(64 + version)}`;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;

  const designData = {
    productId,
    designKey: finalDesignKey,
    slug,
    name,
    code,
    status: "draft",
    version,
    briefId: briefId || null,
    description: description || null,
    textElements: textElements || [],
    styleTags: styleTags || [],
    colorwayName: product?.colorway?.name || null,
    colorwayHex: product?.colorway?.hex || null,
    inkColors,
    printMethod,
    maxInkColors: maxInkColors || null,
    placement,
    placementNotes: placementNotes || null,
    sizeSpec: sizeSpec || null,
    artwork: {},
    ai: {
      source: briefId ? "ai-brief" : "manual",
    },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  // Filter out undefined
  const sanitized = Object.fromEntries(
    Object.entries(designData).filter(([_, value]) => value !== undefined)
  );

  const designRef = await db.collection("rp_product_designs").add(sanitized);

  console.log("[createProductDesign] Created design:", designRef.id, "version:", version);

  return {
    ok: true,
    designId: designRef.id,
    version,
    slug,
    designKey: finalDesignKey,
    name,
    status: "draft",
  };
});

/**
 * Create ProductDesign from a DesignConcept
 * 
 * Behavior:
 * - Input: { productId, briefId, conceptId, name? (optional override) }
 * - Read concept doc
 * - Create ProductDesign with concept data
 * - Mark concept as selected
 * - Attach briefId
 */
exports.createDesignFromConcept = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { productId, briefId, conceptId, name, description } = data || {};

  if (!productId || !briefId || !conceptId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "productId, briefId, and conceptId are required"
    );
  }

  console.log("[createDesignFromConcept] Promoting concept:", { conceptId, productId });

  // Fetch concept
  const conceptRef = db.collection("rp_design_concepts").doc(conceptId);
  const conceptSnap = await conceptRef.get();
  
  if (!conceptSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Concept not found");
  }
  
  const concept = conceptSnap.data();
  
  // Verify concept belongs to product and brief
  if (concept.productId !== productId || concept.briefId !== briefId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Concept does not match product or brief"
    );
  }

  // Fetch brief for constraints
  const briefRef = db.collection("rp_design_briefs").doc(briefId);
  const briefSnap = await briefRef.get();
  const brief = briefSnap.exists ? briefSnap.data() : null;

  if (!brief) {
    throw new functions.https.HttpsError("not-found", "Brief not found");
  }

  // Generate designKey from concept title
  const designKey = generateDesignKey(name || concept.title);
  
  // Get next version
  const version = await getNextVersion(db, productId, designKey);

  // Generate slug
  const slug = `${designKey.toLowerCase().replace(/_/g, "-")}-v${version}`;

  // Generate code
  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  const product = productSnap.exists ? productSnap.data() : null;
  const code = product?.baseProductKey 
    ? `${product.baseProductKey}_${designKey}_${String.fromCharCode(64 + version)}`
    : `${designKey}_${String.fromCharCode(64 + version)}`;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;

  const designData = {
    productId,
    designKey,
    slug,
    name: name || concept.title,
    code,
    status: "draft",
    version,
    briefId,
    description: description || concept.description || null,
    textElements: [],
    styleTags: [],
    colorwayName: product?.colorway?.name || null,
    colorwayHex: product?.colorway?.hex || null,
    inkColors: concept.inkColors || [],
    printMethod: brief.constraints?.printMethod || "unknown",
    maxInkColors: brief.constraints?.maxInkColors || null,
    placement: concept.placement,
    placementNotes: concept.rationale || null,
    artwork: {},
    ai: {
      source: "ai-brief",
      generatedAt: concept.createdAt || now,
    },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  // Filter out undefined
  const sanitized = Object.fromEntries(
    Object.entries(designData).filter(([_, value]) => value !== undefined)
  );

  // Create design
  const designRef = await db.collection("rp_product_designs").add(sanitized);

  // Update concept status to "selected"
  await conceptRef.update({
    status: "selected",
  });

  console.log("[createDesignFromConcept] Created design:", designRef.id, "from concept:", conceptId);

  return {
    ok: true,
    designId: designRef.id,
    version,
    slug,
  };
});

/**
 * Zod schema for AI concept output validation
 */
const AIConceptOutputSchema = z.object({
  concepts: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      placement: z.enum([
        "front_center",
        "front_left",
        "front_right",
        "back_center",
        "back_upper",
        "back_lower",
        "waistband",
        "custom",
      ]),
      inkColors: z.array(
        z.object({
          name: z.string().min(1),
          hex: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
          pantone: z.string().optional(),
          notes: z.string().optional(),
        })
      ),
      rationale: z.string().optional(),
    })
  ).min(1).max(8),
});

/**
 * Create DesignBrief with AI-generated concepts
 * 
 * Behavior:
 * - Input: { productId, title, objective, constraints, inspiration }
 * - Write brief doc status="draft"
 * - Call OpenAI (strict JSON)
 * - Zod-validate response
 * - Create N concept docs
 * - Update brief to status="final" and store AI metadata
 */
exports.createDesignBrief = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const {
    productId,
    title,
    objective,
    audience,
    brandNotes,
    constraints,
    inspiration,
    inspirationIds,
  } = data || {};

  if (!productId || !title || !objective || !constraints) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "productId, title, objective, and constraints are required"
    );
  }

  console.log("[createDesignBrief] Creating brief:", { productId, title, inspirationIds });

  // Fetch product for context
  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  
  if (!productSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Product not found");
  }
  
  const product = productSnap.data();

  // Fetch inspirations if provided
  let inspirations = [];
  if (inspirationIds && Array.isArray(inspirationIds) && inspirationIds.length > 0) {
    console.log("[createDesignBrief] Fetching inspirations:", inspirationIds);
    const inspirationPromises = inspirationIds.map((id) =>
      db.collection("rp_inspirations").doc(id).get()
    );
    const inspirationSnaps = await Promise.all(inspirationPromises);
    inspirations = inspirationSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ id: snap.id, ...snap.data() }));
    console.log("[createDesignBrief] Fetched", inspirations.length, "inspirations");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;

  // Create brief doc as draft
  const briefData = {
    productId,
    status: "draft",
    title,
    objective,
    audience: audience || null,
    brandNotes: brandNotes || null,
    constraints: {
      printMethod: constraints.printMethod || "unknown",
      maxInkColors: constraints.maxInkColors || 4,
      mustIncludeText: constraints.mustIncludeText || [],
      avoid: constraints.avoid || [],
      placementOptions: constraints.placementOptions || [],
      colorway: product.colorway ? {
        name: product.colorway.name,
        hex: product.colorway.hex || null,
      } : null,
      requiredInkColors: constraints.requiredInkColors || [],
      allowedInkColors: constraints.allowedInkColors || [],
    },
    inspiration: inspiration || null,
    inspirationIds: inspirationIds && inspirationIds.length > 0 ? inspirationIds : null,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };

  const sanitized = Object.fromEntries(
    Object.entries(briefData).filter(([_, value]) => value !== undefined)
  );

  const briefRef = await db.collection("rp_design_briefs").add(sanitized);

  try {
    // Build OpenAI prompt
    const openaiPrompt = `You are a senior apparel graphic designer and screenprint production expert.

Create design concepts for:
Product: ${product.name} (${product.category})
Colorway: ${product.colorway?.name || "Unknown"}
Base Product: ${product.baseProductKey}

Design Brief:
Title: ${title}
Objective: ${objective}
${audience ? `Target Audience: ${audience}` : ""}
${brandNotes ? `Brand Notes: ${brandNotes}` : ""}

Constraints:
- Print Method: ${constraints.printMethod}
- Max Ink Colors: ${constraints.maxInkColors}
${constraints.mustIncludeText?.length ? `- Must Include Text: ${constraints.mustIncludeText.join(", ")}` : ""}
${constraints.avoid?.length ? `- Avoid: ${constraints.avoid.join(", ")}` : ""}
${constraints.placementOptions?.length ? `- Placement Options: ${constraints.placementOptions.join(", ")}` : ""}

${inspirations.length > 0 ? `\nVisual Inspiration (use as reference only, do not replicate exact artwork):
${inspirations.map((insp) => {
  return `- ${insp.title}${insp.description ? `: ${insp.description}` : ""}${insp.tags && insp.tags.length > 0 ? ` (Tags: ${insp.tags.join(", ")})` : ""}`;
}).join("\n")}

IMPORTANT: Use these inspirations to guide style, layout, tone, and placement. Match the aesthetic and creative direction, but do NOT replicate exact artwork or designs. Create original concepts inspired by these references.` : ""}
${inspiration?.notes ? `\nAdditional Inspiration Notes: ${inspiration.notes}` : ""}

Generate 3-6 design concepts. Return STRICT JSON only (no markdown, no explanation):

{
  "concepts": [
    {
      "title": "Design name",
      "description": "Full description",
      "placement": "front_center|front_left|front_right|back_center|back_upper|back_lower|waistband|custom",
      "inkColors": [
        {
          "name": "Color name",
          "hex": "#RRGGBB",
          "pantone": "Optional pantone",
          "notes": "Optional notes"
        }
      ],
      "rationale": "Why this works"
    }
  ]
}`;

    // Initialize OpenAI client
    const openaiApiKey = functions.config().openai?.key || process.env.OPENAI_API_KEY;
    
    if (!openaiApiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "OpenAI API key not configured. Set functions.config().openai.key"
      );
    }

    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    console.log("[createDesignBrief] Calling OpenAI...");

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a senior apparel graphic designer and screenprint production expert. Always return valid JSON only, no markdown, no explanation.",
        },
        {
          role: "user",
          content: openaiPrompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2000,
    });

    const responseText = completion.choices[0].message.content;
    console.log("[createDesignBrief] OpenAI response:", responseText);

    // Parse and validate with Zod
    let parsed;
    try {
      const jsonData = JSON.parse(responseText);
      parsed = AIConceptOutputSchema.parse(jsonData);
    } catch (error) {
      console.error("[createDesignBrief] Validation error:", error);
      throw new functions.https.HttpsError(
        "internal",
        `AI response validation failed: ${error.message}`
      );
    }

    // Create concept docs
    const conceptRefs = [];
    for (const conceptData of parsed.concepts) {
      const conceptDoc = {
        productId,
        briefId: briefRef.id,
        title: conceptData.title,
        description: conceptData.description,
        placement: conceptData.placement,
        inkColors: conceptData.inkColors,
        rationale: conceptData.rationale || null,
        status: "proposed",
        createdAt: now,
        createdBy: userId,
      };

      const conceptRef = await db.collection("rp_design_concepts").add(conceptDoc);
      conceptRefs.push(conceptRef.id);
    }

    // Update brief to final with AI metadata
    await briefRef.update({
      status: "final",
      aiOutput: {
        summary: `Generated ${parsed.concepts.length} design concepts`,
        conceptsGenerated: parsed.concepts.length,
        model: "gpt-4o-mini",
        prompt: openaiPrompt,
      },
      updatedAt: now,
    });

    console.log("[createDesignBrief] Created brief:", briefRef.id, "with", parsed.concepts.length, "concepts");

    return {
      ok: true,
      briefId: briefRef.id,
      conceptIds: conceptRefs,
      conceptsGenerated: parsed.concepts.length,
    };
  } catch (error) {
    console.error("[createDesignBrief] Error:", error);
    
    // Update brief with error status
    await briefRef.update({
      status: "draft", // Keep as draft on error
      lastError: {
        message: error.message,
        code: error.code,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    throw new functions.https.HttpsError(
      "internal",
      `Failed to generate design brief: ${error.message}`
    );
  }
});

// ---------------------------------------------------------------------------
// Inspiration Library System Functions
// ---------------------------------------------------------------------------

/**
 * Create an inspiration item
 * Accepts images as base64 strings or Storage paths
 */
exports.createInspiration = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const {
    title,
    description,
    sourceType,
    sourceUrl,
    category,
    tags = [],
    licenseNote,
    images, // Array of { data: base64 string, filename: string } or { storagePath: string }
  } = data || {};

  // Validation
  if (!title || !sourceType) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "title and sourceType are required"
    );
  }

  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "At least one image is required"
    );
  }

  if (images.length > 5) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Maximum 5 images allowed"
    );
  }

  if (tags.length > 10) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Maximum 10 tags allowed"
    );
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;
  const bucket = storage.bucket();
  const imageUrls = [];

  try {
    // Create inspiration document first to get ID
    const inspirationRef = db.collection("rp_inspirations").doc();
    const inspirationId = inspirationRef.id;

    // Upload images to Storage
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      let downloadUrl;

      if (image.storagePath) {
        // Already in Storage, use existing path
        const file = bucket.file(image.storagePath);
        const [exists] = await file.exists();
        if (!exists) {
          throw new functions.https.HttpsError(
            "not-found",
            `Image not found at path: ${image.storagePath}`
          );
        }
        await file.makePublic();
        downloadUrl = `https://storage.googleapis.com/${bucket.name}/${image.storagePath}`;
      } else if (image.data) {
        // Base64 data, upload it
        const base64Data = image.data.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const extension = image.filename?.split(".").pop() || "png";
        const storagePath = `rp/inspirations/${inspirationId}/${Date.now()}_${i}.${extension}`;
        const file = bucket.file(storagePath);

        // Determine content type
        const contentType = image.data.startsWith("data:image/jpeg") 
          ? "image/jpeg" 
          : image.data.startsWith("data:image/png")
          ? "image/png"
          : "image/png";

        await file.save(buffer, { contentType });
        await file.makePublic();
        downloadUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
      } else {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `Image ${i} must have either 'data' (base64) or 'storagePath'`
        );
      }

      imageUrls.push(downloadUrl);
    }

    // Create inspiration document
    const inspirationData = {
      title,
      description: description || null,
      sourceType,
      sourceUrl: sourceUrl || null,
      category: category || null,
      tags,
      licenseNote: licenseNote || null,
      imageUrls,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const sanitized = Object.fromEntries(
      Object.entries(inspirationData).filter(([_, value]) => value !== undefined)
    );

    await inspirationRef.set(sanitized);

    console.log("[createInspiration] Created inspiration:", inspirationId);

    return {
      ok: true,
      inspirationId,
      imageUrls,
    };
  } catch (error) {
    console.error("[createInspiration] Error:", error);
    throw new functions.https.HttpsError(
      "internal",
      `Failed to create inspiration: ${error.message}`
    );
  }
});

/**
 * Attach inspirations to a product
 */
exports.attachInspirationToProduct = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { productId, inspirationIds = [] } = data || {};

  if (!productId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "productId is required"
    );
  }

  if (!Array.isArray(inspirationIds) || inspirationIds.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "inspirationIds array is required"
    );
  }

  // Verify product exists
  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Product not found");
  }

  // Verify all inspirations exist
  for (const inspirationId of inspirationIds) {
    const inspirationRef = db.collection("rp_inspirations").doc(inspirationId);
    const inspirationSnap = await inspirationRef.get();
    if (!inspirationSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Inspiration not found: ${inspirationId}`
      );
    }
  }

  // Update product with inspirationIds
  await productRef.update({
    inspirationIds: admin.firestore.FieldValue.arrayUnion(...inspirationIds),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("[attachInspirationToProduct] Attached inspirations to product:", productId);

  return { ok: true };
});

/**
 * Attach inspirations to a design brief
 */
exports.attachInspirationToBrief = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { briefId, inspirationIds = [] } = data || {};

  if (!briefId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "briefId is required"
    );
  }

  if (!Array.isArray(inspirationIds) || inspirationIds.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "inspirationIds array is required"
    );
  }

  // Verify brief exists
  const briefRef = db.collection("rp_design_briefs").doc(briefId);
  const briefSnap = await briefRef.get();
  if (!briefSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Design brief not found");
  }

  // Verify all inspirations exist
  for (const inspirationId of inspirationIds) {
    const inspirationRef = db.collection("rp_inspirations").doc(inspirationId);
    const inspirationSnap = await inspirationRef.get();
    if (!inspirationSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Inspiration not found: ${inspirationId}`
      );
    }
  }

  // Update brief with inspirationIds
  await briefRef.update({
    inspirationIds: admin.firestore.FieldValue.arrayUnion(...inspirationIds),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("[attachInspirationToBrief] Attached inspirations to brief:", briefId);

  return { ok: true };
});

// ============================================================================
// Blanks Library System (v2 - Per RP_Blanks_Library_Spec_v2.md)
// ============================================================================

// Style registry per Section 6.1
const STYLE_REGISTRY = {
  "8394": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "panty",
    styleName: "Bikini Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8394-bikini-panty",
    allowedColors: ["Black", "White", "Midnight Navy", "Blue", "Red", "Heather Grey"],
    defaultPrintSides: "back_only",
  },
  "8390": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "thong",
    styleName: "Thong Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8390-thong-panty",
    allowedColors: ["Black", "White", "Midnight Navy", "Blue", "Red", "Heather Grey"],
    defaultPrintSides: "back_only",
  },
  "TR3008": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Tri-blend Racerback Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/tr3008-tri-blend-racerback-tank",
    allowedColors: ["Black", "Indigo", "Athletic Grey"],
    defaultPrintSides: "front_only",
  },
  "1822GD": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Garment Dye Crop Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/1822gd-garment-dye-crop-tank",
    allowedColors: ["Black", "Blue", "White"],
    defaultPrintSides: "front_only",
  },
  "HF07": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "crewneck",
    styleName: "Heavy Fleece Crewneck (Garment Dye)",
    supplierUrl: "https://losangelesapparel.net/products/hf07-heavy-fleece-crewneck-sweater-garment-dye",
    allowedColors: ["Black", "Navy", "Off-White"],
    defaultPrintSides: "front_only",
  },
};

const ALL_STYLE_CODES = ["8394", "8390", "TR3008", "1822GD", "HF07"];

// Color registry per Section 6.2
const COLOR_REGISTRY = {
  "Black": "#000000",
  "White": "#FFFFFF",
  "Midnight Navy": "#1C2841",
  "Blue": "#0066CC",
  "Red": "#CC0000",
  "Heather Grey": "#9B9B9B",
  "Indigo": "#3F51B5",
  "Athletic Grey": "#808080",
  "Navy": "#001F3F",
  "Off-White": "#FAF9F6",
};

// Slug builder per Section 6.3
function buildBlankSlug(styleCode, colorName) {
  return `laa-${styleCode.toLowerCase()}-${colorName.toLowerCase().replace(/\s+/g, "-")}`;
}

const MASTER_BLANK_SCHEMA_VERSION = 2;

function buildMasterBlankSlug(styleCode) {
  return `laa-master-${String(styleCode).toLowerCase()}`;
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

/**
 * Build canonical product identity key. Format:
 * {leagueCode}_{teamCode}_{designId}_{blankId}_{blankVariantIdOrLegacy}
 * Canonical team source: prefer DesignTeam.teamCode, else DesignTeam.id.
 */
function buildProductIdentityKey(params) {
  const norm = (s) => {
    if (s == null || typeof s !== "string") return "";
    return String(s)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 128) || "";
  };
  const league = norm(params.leagueCode) || "LEAGUE";
  const team = norm(params.teamCode) || "TEAM";
  const design = norm(params.designId) || "";
  const blank = norm(params.blankId) || "";
  const variant = norm(params.blankVariantIdOrLegacy) || "legacy";
  const parts = [league, team, design, blank, variant].filter(Boolean);
  const sizeSeg = norm(params.garmentSizeCode || "");
  if (sizeSeg) parts.push(sizeSeg);
  return parts.join("_");
}

/** Parent dedupe: league_team_design_blank (4 segments). */
function buildParentProductIdentityKey(params) {
  const norm = (s) => {
    if (s == null || typeof s !== "string") return "";
    return String(s)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 128) || "";
  };
  const league = norm(params.leagueCode) || "LEAGUE";
  const team = norm(params.teamCode) || "TEAM";
  const design = norm(params.designId) || "";
  const blank = norm(params.blankId) || "";
  return [league, team, design, blank].filter(Boolean).join("_");
}

/**
 * Copy `rp_blanks.garmentSizes` onto parent `rp_products` for UI/preview (canonical: blank).
 */
function deriveAvailableSizesFromBlank(blank) {
  const order = ["XS", "S", "M", "L", "XL"];
  const allowed = new Set(order);
  const raw = blank && blank.garmentSizes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const picked = new Set();
  for (const s of raw) {
    if (typeof s === "string" && allowed.has(s)) picked.add(s);
  }
  const out = [];
  for (const code of order) {
    if (picked.has(code)) out.push(code);
  }
  return out.length ? out : null;
}

/** Sizes for Color × Size variant rows: blank `garmentSizes` or full XS–XL. */
function deriveSizesForProductMatrix(blank) {
  const fromBlank = deriveAvailableSizesFromBlank(blank);
  if (fromBlank && fromBlank.length > 0) return fromBlank;
  return ["XS", "S", "M", "L", "XL"];
}

/** Parent storefront cache: 8394 is back-print — hero prefers primary back (blended or clean); thumb can be blank front. */
function pickParentDisplayMediaFromVariantMedia(media, productMockUrl, blankStyleCode) {
  const m = media || {};
  const backFirst = String(blankStyleCode || "").trim() === "8394";
  const heroUrl = backFirst
    ? m.heroBack || m.heroFront || productMockUrl
    : m.heroFront || m.heroBack || productMockUrl;
  const thumbUrl = backFirst
    ? m.heroFront || m.heroBack || productMockUrl
    : m.heroBack || m.heroFront || heroUrl;
  return { heroUrl, thumbUrl };
}

/** Resolve variant row for product generation; legacy blanks use synthetic variant */
function resolveBlankVariantForProduct(blank, blankVariantId) {
  if (blank.schemaVersion === MASTER_BLANK_SCHEMA_VERSION && blank.variants && blank.variants.length > 0) {
    if (!blankVariantId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "blankVariantId is required for master blanks with variants"
      );
    }
    const v = blank.variants.find((x) => x.variantId === blankVariantId);
    if (!v) {
      throw new functions.https.HttpsError("not-found", `Variant ${blankVariantId} not found on blank`);
    }
    if (v.isActive === false) {
      throw new functions.https.HttpsError("failed-precondition", "Variant is inactive");
    }
    return v;
  }
  return {
    variantId: blankVariantId || "legacy",
    colorName: blank.colorName || "",
    colorHex: blank.colorHex || null,
    colorFamily: blank.colorFamily || deriveColorFamilyFromName(blank.colorName),
    images: {
      front: blank.images?.front || null,
      back: blank.images?.back || null,
      detail: null,
    },
  };
}

const { DEFAULT_GARMENT_SAFE_AREA } = require("./lib/designArtboardSpec");

// Default placements per Section 6.4
function getDefaultPlacements(category) {
  const sa = { ...DEFAULT_GARMENT_SAFE_AREA };
  return [
    {
      placementId: "front_center",
      label: "Front Center",
      defaultX: 0.5,
      defaultY: 0.5,
      defaultScale: 0.6,
      safeArea: sa,
    },
    {
      placementId: "back_center",
      label: "Back Center",
      defaultX: 0.5,
      defaultY: 0.5,
      defaultScale: 0.6,
      safeArea: { ...DEFAULT_GARMENT_SAFE_AREA },
    },
  ];
}

// Generate tags
function generateBlankTags(styleCode, colorName, category) {
  return [
    category,
    styleCode.toLowerCase(),
    colorName.toLowerCase().replace(/\s+/g, "-"),
    "los-angeles-apparel",
    "laa",
  ];
}

// Generate search keywords
function generateSearchKeywords(styleCode, styleName, colorName, category) {
  const keywords = new Set();
  keywords.add(styleCode.toLowerCase());
  styleName.toLowerCase().split(/\s+/).forEach(w => keywords.add(w));
  colorName.toLowerCase().split(/\s+/).forEach(w => keywords.add(w));
  keywords.add(category);
  keywords.add("los");
  keywords.add("angeles");
  keywords.add("apparel");
  keywords.add("laa");
  return Array.from(keywords);
}

/**
 * Create Blank: master (style-level, schemaVersion 2) or legacy (one doc per color).
 */
exports.createBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token?.email || null;

  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can create blanks");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userRef = { uid: userId, email: userEmail };

  // Master blank: style-level doc only; colors live in variants[]. Accept redundant flags for robustness.
  const masterBlank =
    data.masterBlank === true ||
    data.masterBlank === "true" ||
    data.createMasterBlank === true ||
    data.createMasterBlank === "true" ||
    data.schemaIntent === "master_v2";

  if (masterBlank) {
    const styleCode = data.styleCode;
    if (!styleCode || typeof styleCode !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "styleCode is required");
    }
    const usePreset = data.useStylePreset === true;
    const preset = STYLE_REGISTRY[styleCode];
    if (usePreset && !preset) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Unknown styleCode for preset: ${styleCode}. Use one of: ${ALL_STYLE_CODES.join(", ")}`
      );
    }

    const styleName =
      data.styleName ||
      (preset ? preset.styleName : null) ||
      styleCode;
    const garmentStyle = data.garmentStyle || styleName;
    const category =
      data.category || (preset ? preset.garmentCategory : null) || "panty";
    const supplier = data.supplier || (preset ? preset.supplier : null) || "Los Angeles Apparel";
    const supplierUrl =
      data.supplierUrl !== undefined ? data.supplierUrl : preset ? preset.supplierUrl : null;

    const slug = buildMasterBlankSlug(styleCode);
    const dup = await db.collection("rp_blanks").where("slug", "==", slug).limit(1).get();
    if (!dup.empty) {
      throw new functions.https.HttpsError("already-exists", `Master blank already exists for style ${styleCode}`);
    }

    const gc = preset ? preset.garmentCategory : category;
    const blankData = {
      schemaVersion: MASTER_BLANK_SCHEMA_VERSION,
      slug,
      status: "draft",
      supplier,
      garmentCategory: gc,
      category,
      styleCode,
      styleName,
      garmentStyle,
      supplierUrl,
      defaultPrintSides:
        preset && preset.defaultPrintSides != null ? preset.defaultPrintSides : garmentCategoryDefaultPrintSides(gc),
      variants: [],
      images: { front: null, back: null },
      imageMeta: null,
      placements: getDefaultPlacements(gc),
      tags: [category, String(styleCode).toLowerCase(), "master-blank", "los-angeles-apparel", "laa"],
      searchKeywords: generateSearchKeywords(styleCode, styleName, "", category),
      createdAt: now,
      createdBy: userRef,
      updatedAt: now,
      updatedBy: userRef,
    };

    const blankRef = await db.collection("rp_blanks").add(blankData);
    await blankRef.update({ blankId: blankRef.id });
    console.log("[createBlank] Created master blank:", blankRef.id, slug);
    return { ok: true, blankId: blankRef.id, slug, schemaVersion: MASTER_BLANK_SCHEMA_VERSION };
  }

  // Legacy: one Firestore doc per style+color (deprecated for new work; prefer masterBlank + variants)
  const { styleCode, colorName } = data;
  if (!styleCode || !STYLE_REGISTRY[styleCode]) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `styleCode must be one of: ${ALL_STYLE_CODES.join(", ")}`
    );
  }
  const styleInfo = STYLE_REGISTRY[styleCode];
  if (!colorName) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "This call is missing masterBlank/createMasterBlank flags and has no colorName. " +
        "To create a master blank (one doc per style, add colors as variants on the blank detail page), pass masterBlank: true with styleCode only. " +
        "Deploy the latest createBlank Cloud Function if you still see this after passing masterBlank: true."
    );
  }
  if (!styleInfo.allowedColors.includes(colorName)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `colorName must be one of: ${styleInfo.allowedColors.join(", ")}`
    );
  }
  const slug = buildBlankSlug(styleCode, colorName);
  const existingQuery = await db.collection("rp_blanks").where("slug", "==", slug).limit(1).get();
  if (!existingQuery.empty) {
    throw new functions.https.HttpsError("already-exists", `A blank with slug "${slug}" already exists`);
  }

  const blankData = {
    slug,
    status: "draft",
    supplier: styleInfo.supplier,
    garmentCategory: styleInfo.garmentCategory,
    category: styleInfo.garmentCategory,
    styleCode,
    styleName: styleInfo.styleName,
    supplierUrl: styleInfo.supplierUrl,
    colorName,
    colorHex: COLOR_REGISTRY[colorName] || null,
    images: { front: null, back: null },
    imageMeta: null,
    placements: getDefaultPlacements(styleInfo.garmentCategory),
    tags: generateBlankTags(styleCode, colorName, styleInfo.garmentCategory),
    searchKeywords: generateSearchKeywords(styleCode, styleInfo.styleName, colorName, styleInfo.garmentCategory),
    createdAt: now,
    createdBy: userRef,
    updatedAt: now,
    updatedBy: userRef,
  };

  const blankRef = await db.collection("rp_blanks").add(blankData);
  await blankRef.update({ blankId: blankRef.id });
  console.log("[createBlank] Created legacy blank:", blankRef.id, slug);
  return { ok: true, blankId: blankRef.id, slug };
});

/**
 * Seed all LA Apparel blanks (21 total per Section 10)
 * - 8394 x 6 colors = 6 blanks (panty)
 * - 8390 x 6 colors = 6 blanks (thong)
 * - TR3008 x 3 colors = 3 blanks (tank)
 * - 1822GD x 3 colors = 3 blanks (tank)
 * - HF07 x 3 colors = 3 blanks (crewneck)
 */
exports.seedBlanks = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token?.email || null;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can seed blanks");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userRef = { uid: userId, email: userEmail };
  const results = [];

  for (const styleCode of ALL_STYLE_CODES) {
    const styleInfo = STYLE_REGISTRY[styleCode];

    for (const colorName of styleInfo.allowedColors) {
      const slug = buildBlankSlug(styleCode, colorName);

      // Check if already exists
      const existingQuery = await db
        .collection("rp_blanks")
        .where("slug", "==", slug)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        results.push({ styleCode, colorName, slug, status: "skipped", reason: "already exists" });
        continue;
      }

      const blankData = {
        slug,
        status: "draft",
        supplier: styleInfo.supplier,
        garmentCategory: styleInfo.garmentCategory,
        styleCode,
        styleName: styleInfo.styleName,
        supplierUrl: styleInfo.supplierUrl,
        colorName,
        colorHex: COLOR_REGISTRY[colorName] || null,
        images: {
          front: null,
          back: null,
        },
        imageMeta: null,
        placements: getDefaultPlacements(styleInfo.garmentCategory),
        tags: generateBlankTags(styleCode, colorName, styleInfo.garmentCategory),
        searchKeywords: generateSearchKeywords(styleCode, styleInfo.styleName, colorName, styleInfo.garmentCategory),
        createdAt: now,
        createdBy: userRef,
        updatedAt: now,
        updatedBy: userRef,
      };

      const blankRef = await db.collection("rp_blanks").add(blankData);
      await blankRef.update({ blankId: blankRef.id });

      results.push({ styleCode, colorName, slug, status: "created", blankId: blankRef.id });
    }
  }

  const created = results.filter(r => r.status === "created").length;
  const skipped = results.filter(r => r.status === "skipped").length;

  console.log("[seedBlanks] Seeded blanks:", created, "created,", skipped, "skipped");

  return {
    ok: true,
    results,
    created,
    skipped,
    total: results.length,
  };
});

/**
 * Seed one master blank per style with color variants (canonical model).
 */
exports.seedMasterBlanks = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const userId = context.auth.uid;
  const userEmail = context.auth.token?.email || null;
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can seed blanks");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userRef = { uid: userId, email: userEmail };
  const results = [];

  for (const styleCode of ALL_STYLE_CODES) {
    const styleInfo = STYLE_REGISTRY[styleCode];
    const slug = buildMasterBlankSlug(styleCode);
    const existing = await db.collection("rp_blanks").where("slug", "==", slug).limit(1).get();
    if (!existing.empty) {
      results.push({ styleCode, slug, status: "skipped", reason: "master exists" });
      continue;
    }

    let sortOrder = 0;
    const variants = styleInfo.allowedColors.map((colorName) => {
      const vid = `${styleCode.toLowerCase()}_${colorName.toLowerCase().replace(/\s+/g, "_")}`;
      return {
        variantId: vid,
        colorName,
        colorHex: COLOR_REGISTRY[colorName] || null,
        colorFamily: deriveColorFamilyFromName(colorName),
        isActive: true,
        sortOrder: sortOrder++,
        images: { front: null, back: null, detail: null },
        renderOverrides: null,
      };
    });

    const blankData = {
      schemaVersion: MASTER_BLANK_SCHEMA_VERSION,
      slug,
      status: "draft",
      supplier: styleInfo.supplier,
      garmentCategory: styleInfo.garmentCategory,
      category: styleInfo.garmentCategory,
      styleCode,
      styleName: styleInfo.styleName,
      garmentStyle: styleInfo.styleName,
      supplierUrl: styleInfo.supplierUrl,
      defaultPrintSides:
        styleInfo.defaultPrintSides != null
          ? styleInfo.defaultPrintSides
          : garmentCategoryDefaultPrintSides(styleInfo.garmentCategory),
      variants,
      images: { front: null, back: null },
      imageMeta: null,
      placements: getDefaultPlacements(styleInfo.garmentCategory),
      tags: [styleInfo.garmentCategory, styleCode.toLowerCase(), "master-blank", "los-angeles-apparel", "laa"],
      searchKeywords: generateSearchKeywords(styleCode, styleInfo.styleName, "", styleInfo.garmentCategory),
      createdAt: now,
      createdBy: userRef,
      updatedAt: now,
      updatedBy: userRef,
    };

    const blankRef = await db.collection("rp_blanks").add(blankData);
    await blankRef.update({ blankId: blankRef.id });
    results.push({ styleCode, slug, status: "created", blankId: blankRef.id, variantCount: variants.length });
  }

  const created = results.filter((r) => r.status === "created").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  console.log("[seedMasterBlanks]", created, "created,", skipped, "skipped");
  return { ok: true, results, created, skipped, total: results.length };
});

/**
 * One-time / occasional: persist `defaultPrintSides` on all blanks from STYLE_REGISTRY + category fallback.
 * Skips docs that already have an explicit value unless `force: true`.
 */
exports.backfillBlankDefaultPrintSides = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const adminSnap = await db.collection("admins").doc(context.auth.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can backfill blanks");
  }

  const dryRun = data?.dryRun !== false;
  const force = data?.force === true;

  function targetDefaultPrintSidesForBlank(b) {
    const sc = String(b.styleCode || "").trim();
    const preset = STYLE_REGISTRY[sc];
    if (preset && preset.defaultPrintSides) return preset.defaultPrintSides;
    return garmentCategoryDefaultPrintSides(b.garmentCategory);
  }

  const snap = await db.collection("rp_blanks").get();
  const planned = [];
  for (const doc of snap.docs) {
    const b = doc.data() || {};
    const next = targetDefaultPrintSidesForBlank(b);
    const cur = b.defaultPrintSides;
    const hasExplicit =
      cur === "front_only" || cur === "back_only" || cur === "both";
    if (!force && hasExplicit) continue;
    if (cur === next) continue;
    planned.push({
      ref: doc.ref,
      id: doc.id,
      blankId: b.blankId || doc.id,
      next,
      prev: cur ?? null,
    });
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      force,
      wouldUpdate: planned.length,
      sample: planned.slice(0, 25),
    };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const chunk = 400;
  let updated = 0;
  for (let i = 0; i < planned.length; i += chunk) {
    const batch = db.batch();
    const slice = planned.slice(i, i + chunk);
    for (const p of slice) {
      batch.update(p.ref, {
        defaultPrintSides: p.next,
        updatedAt: now,
        updatedBy: { uid: context.auth.uid, email: context.auth.token?.email || null },
      });
    }
    await batch.commit();
    updated += slice.length;
  }

  console.log("[backfillBlankDefaultPrintSides] updated", updated, "force=", force);
  return { ok: true, dryRun: false, force, updated };
});

const RENDER_TARGET_KEYS = ["flat_front", "flat_back", "model_front", "model_back"];

/** Admin write sanitizer for one `RpRenderTargetSettings` row. */
function sanitizeRenderTargetSettingsRow(v) {
  if (v == null || typeof v !== "object") return null;
  const BLEND_MODES = new Set(["clean", "soft", "vintage", "bold"]);
  const pl = v.placement;
  const bl = v.blend;
  if (!pl || typeof pl !== "object" || !bl || typeof bl !== "object") return null;
  const scale = pl.scale != null ? Number(pl.scale) : NaN;
  const x = pl.x != null ? Number(pl.x) : NaN;
  const y = pl.y != null ? Number(pl.y) : NaN;
  if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const fabricFeel = bl.fabricFeel != null ? Number(bl.fabricFeel) : NaN;
  const printStrength = bl.printStrength != null ? Number(bl.printStrength) : NaN;
  if (!Number.isFinite(fabricFeel) || !Number.isFinite(printStrength)) return null;
  const row = {
    placement: { scale, x, y },
    blend: { fabricFeel, printStrength },
  };
  if (pl.safeArea === true) row.placement.safeArea = true;
  else if (pl.safeArea === false) row.placement.safeArea = false;
  if (typeof bl.mode === "string" && BLEND_MODES.has(bl.mode)) row.blend.mode = bl.mode;
  if (v.warp && typeof v.warp === "object" && (v.warp.enabled === true || v.warp.enabled === false)) {
    row.warp = { enabled: v.warp.enabled };
    for (const [wk, wv] of [
      ["warpStrength", v.warp.warpStrength],
      ["verticalStretch", v.warp.verticalStretch],
      ["horizontalWarp", v.warp.horizontalWarp],
    ]) {
      if (wv != null && Number.isFinite(Number(wv))) row.warp[wk] = Number(wv);
    }
  }
  if (v.mask && typeof v.mask === "object" && (v.mask.enabled === true || v.mask.enabled === false)) {
    row.mask = { enabled: v.mask.enabled };
    if (v.mask.feather != null && Number.isFinite(Number(v.mask.feather)))
      row.mask.feather = Number(v.mask.feather);
    if (v.mask.edgeFade != null && Number.isFinite(Number(v.mask.edgeFade)))
      row.mask.edgeFade = Number(v.mask.edgeFade);
  }
  return row;
}

/** Admin write sanitizer for `rp_blanks.renderProfile` (per-render-target tuning + optional per-color matrix). */
function sanitizeBlankRenderProfileForWrite(rp) {
  if (rp == null || typeof rp !== "object") return null;
  const ALLOWED = new Set(RENDER_TARGET_KEYS);
  const renderTargets = {};
  const rtRaw = rp.renderTargets;
  if (rtRaw && typeof rtRaw === "object") {
    for (const key of ALLOWED) {
      const row = sanitizeRenderTargetSettingsRow(rtRaw[key]);
      if (row) renderTargets[key] = row;
    }
  }
  const renderTargetsByColor = {};
  const byColorRaw = rp.renderTargetsByColor;
  if (byColorRaw && typeof byColorRaw === "object") {
    for (const [vid, map] of Object.entries(byColorRaw)) {
      if (typeof vid !== "string" || vid.length < 1 || vid.length > 200) continue;
      if (!map || typeof map !== "object") continue;
      const inner = {};
      for (const key of ALLOWED) {
        const row = sanitizeRenderTargetSettingsRow(map[key]);
        if (row) inner[key] = row;
      }
      if (Object.keys(inner).length) renderTargetsByColor[vid] = inner;
    }
  }
  const out = {};
  if (Object.keys(renderTargets).length) out.renderTargets = renderTargets;
  if (Object.keys(renderTargetsByColor).length) out.renderTargetsByColor = renderTargetsByColor;
  return Object.keys(out).length ? out : null;
}

/**
 * Update a Blank (v2)
 * Allows status updates and image attachments
 */
exports.updateBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token?.email || null;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can update blanks");
  }

  const {
    blankId,
    status,
    frontImage,
    backImage,
    imageMeta,
    clearFrontImage,
    clearBackImage,
    colorFamily,
    shopifyDefaults,
    titleTemplate,
    descriptionTemplate,
    tagTemplates,
    defaultPricing,
    defaultShipping,
    renderDefaults,
    sourcing,
    blankCost,
    costCurrency,
    placementNotes,
    version,
    placements: placementsInput,
    variants: variantsInput,
    schemaVersion: schemaVersionInput,
    category: categoryInput,
    garmentStyle: garmentStyleInput,
    garmentCategory: garmentCategoryInput,
    styleName: styleNameInput,
    supplier: supplierInput,
    supplierUrl: supplierUrlInput,
    eligibility: eligibilityInput,
    renderProfileStatus,
    renderProfileNotes,
    supportedRenderViews: supportedRenderViewsInput,
    preferredFlatLook8394: preferredFlatLook8394Input,
    garmentSizes: garmentSizesInput,
    defaultPrintSides: defaultPrintSidesInput,
    shopifyVariantMode: shopifyVariantModeInput,
    renderProfile: renderProfileInput,
  } = data;

  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }

  // Verify blank exists
  const blankRef = db.collection("rp_blanks").doc(blankId);
  const blankSnap = await blankRef.get();
  if (!blankSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Blank not found");
  }

  const updateData = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: { uid: userId, email: userEmail },
  };

  // Status update (draft, active, archived)
  if (status && ["draft", "active", "archived"].includes(status)) {
    updateData.status = status;
  }

  // Clear front image (delete from storage if present, then remove from doc)
  if (clearFrontImage) {
    const blank = blankSnap.data();
    const frontPath = blank?.images?.front?.storagePath;
    if (frontPath) {
      try {
        const bucket = admin.storage().bucket();
        await bucket.file(frontPath).delete();
      } catch (storageErr) {
        console.warn("[updateBlank] Could not delete front image from storage:", storageErr.message);
      }
    }
    updateData["images.front"] = admin.firestore.FieldValue.delete();
  }

  // Clear back image (delete from storage if present, then remove from doc)
  if (clearBackImage) {
    const blank = blankSnap.data();
    const backPath = blank?.images?.back?.storagePath;
    if (backPath) {
      try {
        const bucket = admin.storage().bucket();
        await bucket.file(backPath).delete();
      } catch (storageErr) {
        console.warn("[updateBlank] Could not delete back image from storage:", storageErr.message);
      }
    }
    updateData["images.back"] = admin.firestore.FieldValue.delete();
  }

  // Front image update (RPImageRef object) — only if not clearing
  if (!clearFrontImage && frontImage && frontImage.storagePath && frontImage.downloadUrl) {
    updateData["images.front"] = {
      storagePath: frontImage.storagePath,
      downloadUrl: frontImage.downloadUrl,
      width: frontImage.width || null,
      height: frontImage.height || null,
      contentType: frontImage.contentType || null,
      bytes: frontImage.bytes || null,
    };
  }

  // Back image update (RPImageRef object) — only if not clearing
  if (!clearBackImage && backImage && backImage.storagePath && backImage.downloadUrl) {
    updateData["images.back"] = {
      storagePath: backImage.storagePath,
      downloadUrl: backImage.downloadUrl,
      width: backImage.width || null,
      height: backImage.height || null,
      contentType: backImage.contentType || null,
      bytes: backImage.bytes || null,
    };
  }

  // Image metadata update
  if (imageMeta) {
    updateData.imageMeta = {
      background: imageMeta.background || "unknown",
      source: imageMeta.source || "photo",
      notes: imageMeta.notes || null,
    };
  }

  // Phase 1: Blank as foundation
  if (colorFamily !== undefined) {
    updateData.colorFamily = colorFamily === null || colorFamily === "" ? null : colorFamily;
  }
  if (shopifyDefaults !== undefined) {
    updateData.shopifyDefaults =
      shopifyDefaults == null
        ? null
        : {
            productType: shopifyDefaults.productType ?? null,
            brand: shopifyDefaults.brand ?? shopifyDefaults.vendor ?? null,
            vendor: shopifyDefaults.vendor ?? shopifyDefaults.brand ?? null,
            productCategory: shopifyDefaults.productCategory ?? null,
            collectionHandles: Array.isArray(shopifyDefaults.collectionHandles) ? shopifyDefaults.collectionHandles : null,
            sizeOptionName: shopifyDefaults.sizeOptionName ?? null,
          };
  }
  if (titleTemplate !== undefined) updateData.titleTemplate = titleTemplate == null ? null : titleTemplate;
  if (descriptionTemplate !== undefined) updateData.descriptionTemplate = descriptionTemplate == null ? null : descriptionTemplate;
  if (tagTemplates !== undefined) updateData.tagTemplates = Array.isArray(tagTemplates) ? tagTemplates : null;
  if (defaultPricing !== undefined) {
    updateData.defaultPricing =
      defaultPricing == null
        ? null
        : {
            retailPrice: defaultPricing.retailPrice ?? null,
            cost: defaultPricing.cost ?? null,
            basePrice: defaultPricing.basePrice ?? null,
            compareAtPrice: defaultPricing.compareAtPrice ?? null,
            currencyCode: defaultPricing.currencyCode ?? null,
          };
  }
  if (defaultShipping !== undefined) {
    updateData.defaultShipping =
      defaultShipping == null
        ? null
        : {
            defaultWeightGrams: defaultShipping.defaultWeightGrams ?? null,
            requiresShipping: defaultShipping.requiresShipping ?? null,
          };
  }
  if (renderDefaults !== undefined) {
    updateData.renderDefaults =
      renderDefaults == null
        ? null
        : {
            blendMode: renderDefaults.blendMode ?? null,
            blendOpacity: renderDefaults.blendOpacity ?? null,
            front: renderDefaults.front ?? null,
            back: renderDefaults.back ?? null,
          };
  }
  if (sourcing !== undefined) {
    updateData.sourcing =
      sourcing == null
        ? null
        : {
            supplier: sourcing.supplier ?? null,
            supplierStyleCode: sourcing.supplierStyleCode ?? null,
            supplierProductUrl: sourcing.supplierProductUrl ?? null,
            notes: sourcing.notes ?? null,
            vendor: sourcing.vendor ?? null,
            vendorSku: sourcing.vendorSku ?? null,
            vendorColorName: sourcing.vendorColorName ?? null,
            vendorProductUrl: sourcing.vendorProductUrl ?? null,
          };
  }
  if (blankCost !== undefined) updateData.blankCost = blankCost == null ? null : Number(blankCost);
  if (costCurrency !== undefined) updateData.costCurrency = costCurrency == null ? null : costCurrency;
  if (placementNotes !== undefined) updateData.placementNotes = placementNotes == null ? null : placementNotes;
  if (version !== undefined) updateData.version = version == null ? null : Number(version);

  if (placementsInput !== undefined) {
    if (!Array.isArray(placementsInput)) {
      throw new functions.https.HttpsError("invalid-argument", "placements must be an array");
    }
    updateData.placements = placementsInput.map((p) => ({
      placementId: p.placementId,
      label: p.label ?? p.placementId,
      view: p.view === "front" || p.view === "back" ? p.view : null,
      defaultX: p.defaultX != null ? Number(p.defaultX) : null,
      defaultY: p.defaultY != null ? Number(p.defaultY) : null,
      defaultScale: p.defaultScale != null ? Number(p.defaultScale) : null,
      safeArea:
        p.safeArea && typeof p.safeArea === "object"
          ? {
              x: Number(p.safeArea.x),
              y: Number(p.safeArea.y),
              w: Number(p.safeArea.w),
              h: Number(p.safeArea.h),
            }
          : null,
      artboardBase: p.artboardBase != null ? Number(p.artboardBase) : null,
      artboardNotes: p.artboardNotes != null ? String(p.artboardNotes) : null,
      allowedDesignAssetMode:
        p.allowedDesignAssetMode === "light_dark" ||
        p.allowedDesignAssetMode === "light_only" ||
        p.allowedDesignAssetMode === "dark_only"
          ? p.allowedDesignAssetMode
          : null,
      renderZoneDefaults:
        p.renderZoneDefaults && typeof p.renderZoneDefaults === "object"
          ? {
              blendMode: p.renderZoneDefaults.blendMode ?? null,
              blendOpacity:
                p.renderZoneDefaults.blendOpacity != null
                  ? Number(p.renderZoneDefaults.blendOpacity)
                  : null,
            }
          : null,
      simpleRenderControls8394:
        p.simpleRenderControls8394 && typeof p.simpleRenderControls8394 === "object"
          ? {
              realism:
                p.simpleRenderControls8394.realism != null
                  ? Number(p.simpleRenderControls8394.realism)
                  : null,
              inkStrength:
                p.simpleRenderControls8394.inkStrength != null
                  ? Number(p.simpleRenderControls8394.inkStrength)
                  : null,
              sizePreset: ["small", "medium", "large", "fill_safe"].includes(
                p.simpleRenderControls8394.sizePreset
              )
                ? p.simpleRenderControls8394.sizePreset
                : null,
            }
          : null,
      maskConfig:
        p.maskConfig && typeof p.maskConfig === "object"
          ? {
              mode: p.maskConfig.mode != null ? String(p.maskConfig.mode) : null,
              notes: p.maskConfig.notes != null ? String(p.maskConfig.notes) : null,
            }
          : null,
      profileStatus: p.profileStatus === "draft" || p.profileStatus === "approved" ? p.profileStatus : null,
      notes: p.notes != null ? String(p.notes) : null,
    }));
  }

  if (renderProfileInput !== undefined) {
    if (renderProfileInput === null) {
      updateData.renderProfile = admin.firestore.FieldValue.delete();
    } else if (typeof renderProfileInput === "object" && renderProfileInput !== null) {
      const sanitized = sanitizeBlankRenderProfileForWrite(renderProfileInput);
      if (sanitized == null) {
        updateData.renderProfile = admin.firestore.FieldValue.delete();
      } else {
        updateData.renderProfile = sanitized;
      }
    }
  }

  if (renderProfileStatus !== undefined) {
    updateData.renderProfileStatus =
      renderProfileStatus === "draft" || renderProfileStatus === "approved" ? renderProfileStatus : null;
  }
  if (renderProfileNotes !== undefined) {
    updateData.renderProfileNotes =
      renderProfileNotes == null || renderProfileNotes === "" ? null : String(renderProfileNotes);
  }
  if (supportedRenderViewsInput !== undefined) {
    updateData.supportedRenderViews = Array.isArray(supportedRenderViewsInput)
      ? supportedRenderViewsInput.filter((v) => v === "front" || v === "back")
      : null;
  }

  if (preferredFlatLook8394Input !== undefined) {
    updateData.preferredFlatLook8394 =
      preferredFlatLook8394Input === "flat_clean" || preferredFlatLook8394Input === "flat_blended"
        ? preferredFlatLook8394Input
        : null;
  }

  if (defaultPrintSidesInput !== undefined) {
    if (defaultPrintSidesInput === null || defaultPrintSidesInput === "") {
      updateData.defaultPrintSides = admin.firestore.FieldValue.delete();
    } else if (["front_only", "back_only", "both"].includes(defaultPrintSidesInput)) {
      updateData.defaultPrintSides = defaultPrintSidesInput;
    }
  }

  if (shopifyVariantModeInput !== undefined) {
    if (shopifyVariantModeInput === null || shopifyVariantModeInput === "") {
      updateData.shopifyVariantMode = admin.firestore.FieldValue.delete();
    } else if (shopifyVariantModeInput === "color" || shopifyVariantModeInput === "color_size") {
      updateData.shopifyVariantMode = shopifyVariantModeInput;
    }
  }

  if (variantsInput !== undefined) {
    if (!Array.isArray(variantsInput)) {
      throw new functions.https.HttpsError("invalid-argument", "variants must be an array");
    }
    updateData.variants = variantsInput.map((v) => ({
      variantId: v.variantId,
      colorName: v.colorName,
      colorHex: v.colorHex ?? null,
      colorFamily: v.colorFamily || deriveColorFamilyFromName(v.colorName),
      preferredArtworkTone:
        v.preferredArtworkTone === "light" ||
        v.preferredArtworkTone === "dark" ||
        v.preferredArtworkTone === "white"
          ? v.preferredArtworkTone
          : null,
      vendorColorName: v.vendorColorName ?? null,
      vendorColorCode: v.vendorColorCode ?? null,
      vendorSku: v.vendorSku ?? null,
      isActive: v.isActive !== false,
      sortOrder: v.sortOrder != null ? Number(v.sortOrder) : null,
      images: v.images || { front: null, back: null, detail: null },
      marketingImages: Array.isArray(v.marketingImages) ? v.marketingImages : null,
      renderOverrides: v.renderOverrides ?? null,
      renderProfileOverrides:
        v.renderProfileOverrides && typeof v.renderProfileOverrides === "object"
          ? v.renderProfileOverrides
          : null,
      renderTargetOverrides:
        v.renderTargetOverrides && typeof v.renderTargetOverrides === "object"
          ? v.renderTargetOverrides
          : null,
      eligibilityOverride:
        v.eligibilityOverride && typeof v.eligibilityOverride === "object"
          ? {
              enabled: v.eligibilityOverride.enabled === true,
              allowedLeagues: Array.isArray(v.eligibilityOverride.allowedLeagues)
                ? v.eligibilityOverride.allowedLeagues
                : null,
              allowAllTeamsInAllowedLeagues:
                v.eligibilityOverride.allowAllTeamsInAllowedLeagues === null
                  ? null
                  : v.eligibilityOverride.allowAllTeamsInAllowedLeagues !== false,
              matchTeamColorFamilies:
                v.eligibilityOverride.matchTeamColorFamilies === true
                  ? true
                  : v.eligibilityOverride.matchTeamColorFamilies === false
                    ? false
                    : null,
              allowedTeamColorFamilies: Array.isArray(v.eligibilityOverride.allowedTeamColorFamilies)
                ? v.eligibilityOverride.allowedTeamColorFamilies
                : null,
              includedTeamIds: Array.isArray(v.eligibilityOverride.includedTeamIds)
                ? v.eligibilityOverride.includedTeamIds
                : null,
              excludedTeamIds: Array.isArray(v.eligibilityOverride.excludedTeamIds)
                ? v.eligibilityOverride.excludedTeamIds
                : null,
            }
          : null,
    }));
  }

  if (schemaVersionInput !== undefined) updateData.schemaVersion = Number(schemaVersionInput);
  if (categoryInput !== undefined) updateData.category = categoryInput;
  if (garmentStyleInput !== undefined) updateData.garmentStyle = garmentStyleInput;
  if (garmentCategoryInput !== undefined) updateData.garmentCategory = garmentCategoryInput;
  if (styleNameInput !== undefined) updateData.styleName = styleNameInput;
  if (supplierInput !== undefined) updateData.supplier = supplierInput;
  if (supplierUrlInput !== undefined) updateData.supplierUrl = supplierUrlInput;

  const GARMENT_SIZE_CODES_ORDER = ["XS", "S", "M", "L", "XL"];
  const GARMENT_SIZE_SET = new Set(GARMENT_SIZE_CODES_ORDER);
  if (garmentSizesInput !== undefined) {
    if (garmentSizesInput === null) {
      updateData.garmentSizes = null;
    } else if (Array.isArray(garmentSizesInput)) {
      const picked = new Set();
      for (const s of garmentSizesInput) {
        if (typeof s === "string" && GARMENT_SIZE_SET.has(s)) picked.add(s);
      }
      const out = [];
      for (const code of GARMENT_SIZE_CODES_ORDER) {
        if (picked.has(code)) out.push(code);
      }
      updateData.garmentSizes = out.length ? out : null;
    }
  }

  if (eligibilityInput !== undefined) {
    updateData.eligibility =
      eligibilityInput == null
        ? null
        : {
            allowedLeagues: Array.isArray(eligibilityInput.allowedLeagues)
              ? eligibilityInput.allowedLeagues
              : null,
            allowAllTeamsInAllowedLeagues:
              eligibilityInput.allowAllTeamsInAllowedLeagues === null
                ? null
                : eligibilityInput.allowAllTeamsInAllowedLeagues !== false,
            matchTeamColorFamilies:
              eligibilityInput.matchTeamColorFamilies === true
                ? true
                : eligibilityInput.matchTeamColorFamilies === false
                  ? false
                  : null,
            allowedTeamColorFamilies: Array.isArray(eligibilityInput.allowedTeamColorFamilies)
              ? eligibilityInput.allowedTeamColorFamilies
              : null,
            supportedDesignZones: Array.isArray(eligibilityInput.supportedDesignZones)
              ? eligibilityInput.supportedDesignZones
              : null,
            supportedProductFamilies: Array.isArray(eligibilityInput.supportedProductFamilies)
              ? eligibilityInput.supportedProductFamilies
              : null,
            includedTeamIds: Array.isArray(eligibilityInput.includedTeamIds) ? eligibilityInput.includedTeamIds : null,
            excludedTeamIds: Array.isArray(eligibilityInput.excludedTeamIds) ? eligibilityInput.excludedTeamIds : null,
          };
  }

  // Blank version bump: when style-level or variant-level content changes, bump version so products can detect staleness.
  // Bump when: placements, renderDefaults, templates, shopifyDefaults, defaultPricing, defaultShipping, variants.
  const versionBumpKeys = [
    "placements",
    "renderProfile",
    "renderDefaults",
    "renderProfileStatus",
    "renderProfileNotes",
    "supportedRenderViews",
    "titleTemplate",
    "descriptionTemplate",
    "tagTemplates",
    "shopifyDefaults",
    "defaultPricing",
    "defaultShipping",
    "variants",
    "garmentSizes",
  ];
  const shouldBumpVersion = versionBumpKeys.some((k) => updateData[k] !== undefined);
  if (shouldBumpVersion) {
    const current = blankSnap.data().version;
    updateData.version = (typeof current === "number" ? current : 0) + 1;
  }

  await blankRef.update(updateData);

  console.log("[updateBlank] Updated blank:", blankId);

  return { ok: true };
});

/**
 * Delete a Blank. Blocked if any products reference this blank; use Archive (status change) instead.
 */
exports.deleteBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can delete blanks");
  }

  const { blankId } = data;

  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }

  // Verify blank exists
  const blankRef = db.collection("rp_blanks").doc(blankId);
  const blankSnap = await blankRef.get();
  if (!blankSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Blank not found");
  }

  // Block delete if any products reference this blank
  const productsQuery = await db
    .collection("rp_products")
    .where("blankId", "==", blankId)
    .limit(1)
    .get();

  if (!productsQuery.empty) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This blank is used by existing products and cannot be deleted. Archive it instead."
    );
  }

  await blankRef.delete();
  console.log("[deleteBlank] Deleted blank:", blankId);
  return { ok: true, action: "deleted" };
});

// ============================================================================
// Design Assets Library System (Per RP_Design_Assets_Spec.md)
// ============================================================================

// Hex color validation regex
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;

// Default placement values
const DEFAULT_DESIGN_PLACEMENTS = [
  {
    placementId: "front_center",
    x: 0.50,
    y: 0.50,
    scale: 0.60,
    safeArea: { padX: 0.20, padY: 0.20 },
    rotationDeg: 0,
  },
  {
    placementId: "back_center",
    x: 0.50,
    y: 0.50,
    scale: 0.60,
    safeArea: { padX: 0.20, padY: 0.20 },
    rotationDeg: 0,
  },
];

/** Concept themes (Firestore field `designType`); legacy style-era values still accepted on read/write */
const DESIGN_THEME_CANONICAL = new Set([
  "city_69",
  "slogan",
  "stadium",
  "rivalry",
  "number",
  "wordplay",
  "badge_crest",
  "pillows",
  "custom_one_off",
]);
const DESIGN_THEME_LEGACY = new Set(["wordmark", "script", "other", "badge"]);
function isAllowedDesignTheme(v) {
  return typeof v === "string" && (DESIGN_THEME_CANONICAL.has(v) || DESIGN_THEME_LEGACY.has(v));
}
const DESIGN_SIDE_KIND_TO_NESTED = {
  frontLightPng: ["front", "lightPng"],
  frontDarkPng: ["front", "darkPng"],
  frontWhitePng: ["front", "whitePng"],
  backLightPng: ["back", "lightPng"],
  backDarkPng: ["back", "darkPng"],
  backWhitePng: ["back", "whitePng"],
  frontLightSvg: ["front", "lightSvg"],
  frontDarkSvg: ["front", "darkSvg"],
  frontWhiteSvg: ["front", "whiteSvg"],
  backLightSvg: ["back", "lightSvg"],
  backDarkSvg: ["back", "darkSvg"],
  backWhiteSvg: ["back", "whiteSvg"],
  frontLightPdf: ["front", "lightPdf"],
  frontDarkPdf: ["front", "darkPdf"],
  frontWhitePdf: ["front", "whitePdf"],
  backLightPdf: ["back", "lightPdf"],
  backDarkPdf: ["back", "darkPdf"],
  backWhitePdf: ["back", "whitePdf"],
};

const DESIGN_FILE_KINDS = new Set([
  "png",
  "pdf",
  "svg",
  "lightPng",
  "darkPng",
  "whitePng",
  "lightSvg",
  "darkSvg",
  "whiteSvg",
  "lightPdf",
  "darkPdf",
  "whitePdf",
  ...Object.keys(DESIGN_SIDE_KIND_TO_NESTED),
]);

function sideHasNestedPng(files, side) {
  const s = files && files[side];
  if (!s) return false;
  return (
    !!(s.lightPng && s.lightPng.downloadUrl) ||
    !!(s.darkPng && s.darkPng.downloadUrl) ||
    !!(s.whitePng && s.whitePng.downloadUrl)
  );
}

function resolveDefaultSide(files, supportedSides) {
  // Must be a real array: merged design docs can have `supportedSides` as a Firestore FieldValue
  // (e.g. delete sentinel) after spreading update payloads — `(x || []).map` treats that as truthy and throws.
  const ss = Array.isArray(supportedSides)
    ? supportedSides.map((s) => String(s).trim().toLowerCase())
    : [];
  if (ss.length === 1 && ss[0] === "front") return "front";
  if (ss.length === 1 && ss[0] === "back") return "back";
  if (sideHasNestedPng(files, "back") && !sideHasNestedPng(files, "front")) return "back";
  if (sideHasNestedPng(files, "front") && !sideHasNestedPng(files, "back")) return "front";
  return "back";
}

/** Plain value for in-memory merge (never FieldValue) — used by computeDesignIsComplete / resolveDesignAssetUrls. */
function effectiveSupportedSidesAfterUpdate(supportedSidesFromRequest, currentSides) {
  if (supportedSidesFromRequest === undefined) {
    return Array.isArray(currentSides) ? currentSides : undefined;
  }
  if (supportedSidesFromRequest === null) {
    return undefined;
  }
  if (!Array.isArray(supportedSidesFromRequest)) {
    return Array.isArray(currentSides) ? currentSides : undefined;
  }
  const allowed = new Set(["front", "back"]);
  const cleaned = [
    ...new Set(
      supportedSidesFromRequest
        .map((s) => String(s).trim().toLowerCase())
        .filter((s) => allowed.has(s))
    ),
  ];
  return cleaned.length > 0 ? cleaned : undefined;
}

function buildSideAssetsFromFiles(sideFiles) {
  if (!sideFiles) return null;
  const sf = sideFiles;
  const o = {
    lightPng: sf.lightPng && sf.lightPng.downloadUrl ? sf.lightPng.downloadUrl : null,
    darkPng: sf.darkPng && sf.darkPng.downloadUrl ? sf.darkPng.downloadUrl : null,
    whitePng: sf.whitePng && sf.whitePng.downloadUrl ? sf.whitePng.downloadUrl : null,
    lightSvg: sf.lightSvg && sf.lightSvg.downloadUrl ? sf.lightSvg.downloadUrl : null,
    darkSvg: sf.darkSvg && sf.darkSvg.downloadUrl ? sf.darkSvg.downloadUrl : null,
    whiteSvg: sf.whiteSvg && sf.whiteSvg.downloadUrl ? sf.whiteSvg.downloadUrl : null,
    lightPdf: sf.lightPdf && sf.lightPdf.downloadUrl ? sf.lightPdf.downloadUrl : null,
    darkPdf: sf.darkPdf && sf.darkPdf.downloadUrl ? sf.darkPdf.downloadUrl : null,
    whitePdf: sf.whitePdf && sf.whitePdf.downloadUrl ? sf.whitePdf.downloadUrl : null,
  };
  return Object.values(o).some(Boolean) ? o : null;
}

/** Canonical asset URLs on design; mirrors client `resolveDesignAssets` (default print side + legacy flat). */
function resolveDesignAssetUrls(data) {
  const a = data.assets || {};
  const f = data.files || {};
  const side = resolveDefaultSide(f, data.supportedSides);
  const nsA = a[side] || {};
  const nsF = f[side] || {};
  const mergeSlot = slot => nsA[slot] || (nsF[slot] && nsF[slot].downloadUrl) || null;
  const leg = {
    lightPng: a.lightPng || (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null,
    darkPng: a.darkPng || (f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: a.whitePng || (f.whitePng && f.whitePng.downloadUrl) || null,
    lightSvg:
      a.lightSvg || (f.lightSvg && f.lightSvg.downloadUrl) || (f.svg && f.svg.downloadUrl) || null,
    darkSvg: a.darkSvg || (f.darkSvg && f.darkSvg.downloadUrl) || null,
    whiteSvg: a.whiteSvg || (f.whiteSvg && f.whiteSvg.downloadUrl) || null,
    lightPdf: a.lightPdf || (f.lightPdf && f.lightPdf.downloadUrl) || (f.pdf && f.pdf.downloadUrl) || null,
    darkPdf: a.darkPdf || (f.darkPdf && f.darkPdf.downloadUrl) || null,
    whitePdf: a.whitePdf || (f.whitePdf && f.whitePdf.downloadUrl) || null,
  };
  const lightPng = mergeSlot("lightPng") || leg.lightPng;
  const darkPng = mergeSlot("darkPng") || leg.darkPng;
  const whitePng = mergeSlot("whitePng") || leg.whitePng;
  const lightSvg = mergeSlot("lightSvg") || leg.lightSvg;
  const darkSvg = mergeSlot("darkSvg") || leg.darkSvg;
  const whiteSvg = mergeSlot("whiteSvg") || leg.whiteSvg;
  const lightPdf = mergeSlot("lightPdf") || leg.lightPdf;
  const darkPdf = mergeSlot("darkPdf") || leg.darkPdf;
  const whitePdf = mergeSlot("whitePdf") || leg.whitePdf;
  return {
    lightPng,
    darkPng,
    whitePng,
    lightSvg,
    darkSvg,
    whiteSvg,
    svg:
      a.svg ||
      (f.svg && f.svg.downloadUrl) ||
      lightSvg ||
      darkSvg ||
      whiteSvg ||
      null,
    lightPdf,
    darkPdf,
    whitePdf,
    pdf: a.pdf || (f.pdf && f.pdf.downloadUrl) || lightPdf || darkPdf || whitePdf || null,
  };
}

/** Derive assets map from files (legacy flat + optional front/back). */
function buildAssetsFromFiles(files) {
  const f = files || {};
  const lightSvg = (f.lightSvg && f.lightSvg.downloadUrl) || (f.svg && f.svg.downloadUrl) || null;
  const darkSvg = (f.darkSvg && f.darkSvg.downloadUrl) || null;
  const whiteSvg = (f.whiteSvg && f.whiteSvg.downloadUrl) || null;
  const lightPdf = (f.lightPdf && f.lightPdf.downloadUrl) || (f.pdf && f.pdf.downloadUrl) || null;
  const darkPdf = (f.darkPdf && f.darkPdf.downloadUrl) || null;
  const whitePdf = (f.whitePdf && f.whitePdf.downloadUrl) || null;
  const front = buildSideAssetsFromFiles(f.front);
  const back = buildSideAssetsFromFiles(f.back);
  return {
    lightPng: (f.lightPng && f.lightPng.downloadUrl) || (f.png && f.png.downloadUrl) || null,
    darkPng: (f.darkPng && f.darkPng.downloadUrl) || null,
    whitePng: (f.whitePng && f.whitePng.downloadUrl) || null,
    lightSvg,
    darkSvg,
    whiteSvg,
    svg: (f.svg && f.svg.downloadUrl) || lightSvg || darkSvg || whiteSvg || null,
    lightPdf,
    darkPdf,
    whitePdf,
    pdf: (f.pdf && f.pdf.downloadUrl) || lightPdf || darkPdf || whitePdf || null,
    front: front || null,
    back: back || null,
  };
}

function anySideHasPngSlot(files, assets, slot) {
  for (const s of ["front", "back"]) {
    const u = (assets[s] && assets[s][slot]) || (files[s] && files[s][slot] && files[s][slot].downloadUrl);
    if (u) return true;
  }
  return false;
}

/** Merge one uploaded file into `files` (flat legacy or nested `front` / `back`). */
function mergeDesignFiles(currentFiles, kind, fileEntry) {
  const nested = DESIGN_SIDE_KIND_TO_NESTED[kind];
  const base = { ...(currentFiles || {}) };
  if (nested) {
    const [sec, slot] = nested;
    return {
      ...base,
      [sec]: {
        ...(base[sec] || {}),
        [slot]: fileEntry,
      },
    };
  }
  return { ...base, [kind]: fileEntry };
}

function isRasterPngKind(kind) {
  return (
    kind === "png" ||
    kind === "lightPng" ||
    kind === "darkPng" ||
    kind === "whitePng" ||
    /LightPng$/.test(kind) ||
    /DarkPng$/.test(kind) ||
    /WhitePng$/.test(kind)
  );
}

function isSvgFamilyKind(kind) {
  return kind === "svg" || kind === "lightSvg" || kind === "darkSvg" || /Svg$/.test(kind);
}

/** Merge file flags for designs/{id}.files + assets */
function computeDesignPngFlags(files, assets) {
  const u = resolveDesignAssetUrls({ files: files || {}, assets: assets || {} });
  const f = files || {};
  const a = assets || {};
  const hasLightPng =
    !!u.lightPng || anySideHasPngSlot(f, a, "lightPng") || !!(f.png && f.png.downloadUrl);
  const hasDarkPng = !!u.darkPng || anySideHasPngSlot(f, a, "darkPng");
  const hasLegacyPng = !!(f.png && f.png.downloadUrl) && !(f.lightPng && f.lightPng.downloadUrl);
  const hasWhitePng =
    !!u.whitePng || anySideHasPngSlot(f, a, "whitePng");
  const hasPng = hasLightPng || hasDarkPng || hasWhitePng;
  return { hasLightPng, hasDarkPng, hasWhitePng, hasLegacyPng, hasPng };
}

/** Completeness: name + team + designType + both garment PNG URLs (no print colors required) */
function computeDesignIsComplete(data) {
  const u = resolveDesignAssetUrls(data);
  const nameOk = !!(data.name && String(data.name).trim());
  return (
    nameOk &&
    !!data.teamId &&
    !!data.designType &&
    !!u.lightPng &&
    !!u.darkPng &&
    data.status !== "archived"
  );
}

/** Prefer light garment asset, then dark (for batch / fallback) */
function designPngUrlForProcessing(design) {
  const u = resolveDesignAssetUrls(design);
  return u.lightPng || u.darkPng || null;
}

const { MLB_DESIGN_TEAMS } = require("./data/mlbDesignTeams");
const { getCanonicalDesignTeamsPhase1 } = require("./data/canonicalDesignTeamsPhase1");

/**
 * Non-MLB sample teams (MLB is fully covered by MLB_DESIGN_TEAMS).
 * Use official full franchise names in `name` (not abbreviations like "SF …"); stable `id` is the machine key.
 */
const OTHER_SAMPLE_DESIGN_TEAMS = [
  {
    id: "sf_49ers",
    name: "San Francisco 49ers",
    league: "NFL",
    leagueId: "NFL",
    city: "San Francisco",
    state: "CA",
    teamName: "49ers",
    primaryColorHex: "#AA0000",
    tags: ["nfl", "49ers", "san-francisco", "sf"],
  },
  { id: "la_lakers", name: "LA Lakers", league: "NBA", leagueId: "NBA", city: "Los Angeles", state: "CA", teamName: "Lakers", primaryColorHex: "#552583", tags: ["nba", "lakers", "la"] },
  { id: "chicago_bulls", name: "Chicago Bulls", league: "NBA", leagueId: "NBA", city: "Chicago", state: "IL", teamName: "Bulls", primaryColorHex: "#CE1141", tags: ["nba", "bulls", "chicago"] },
  { id: "batch_import", name: "Batch Import", league: null, leagueId: null, city: null, state: null, teamName: null, primaryColorHex: "#6B7280", tags: ["batch", "import"] },
];

const SAMPLE_DESIGN_TEAMS = [...MLB_DESIGN_TEAMS, ...OTHER_SAMPLE_DESIGN_TEAMS];

/**
 * Seed design_teams collection with sample sports teams
 */
exports.seedDesignTeams = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can seed teams");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const results = [];

  for (const team of SAMPLE_DESIGN_TEAMS) {
    const teamRef = db.collection("design_teams").doc(team.id);
    const existingSnap = await teamRef.get();

    if (existingSnap.exists) {
      results.push({ id: team.id, status: "skipped", reason: "already exists" });
      continue;
    }

    await teamRef.set({
      id: team.id,
      name: team.name,
      league: team.league,
      leagueId: team.leagueId !== undefined ? team.leagueId : team.league || null,
      city: team.city !== undefined ? team.city : null,
      state: team.state !== undefined ? team.state : null,
      teamName: team.teamName !== undefined ? team.teamName : null,
      primaryColorHex: team.primaryColorHex,
      tags: team.tags,
      createdAt: now,
      updatedAt: now,
    });

    results.push({ id: team.id, status: "created" });
  }

  const created = results.filter(r => r.status === "created").length;
  const skipped = results.filter(r => r.status === "skipped").length;

  console.log("[seedDesignTeams] Seeded teams:", created, "created,", skipped, "skipped");

  return {
    ok: true,
    results,
    created,
    skipped,
    total: results.length,
  };
});

/**
 * Seed / upsert canonical design_teams Phase 1 (MLB, NFL, NBA, NHL, MLS).
 * Pass { merge: true } to refresh teamCode, slug, colorFamilies, stadiumName, etc. on existing docs.
 */
exports.seedDesignTeamsCanonicalPhase1 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can seed teams");
  }

  const merge = data && data.merge === true;
  const { teams, countsByLeague } = getCanonicalDesignTeamsPhase1();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const results = [];

  for (const team of teams) {
    const teamRef = db.collection("design_teams").doc(team.id);
    const existingSnap = await teamRef.get();
    const doc = {
      id: team.id,
      name: team.name,
      league: team.league ?? null,
      leagueId: team.leagueId ?? team.leagueCode ?? null,
      leagueCode: team.leagueCode ?? team.leagueId ?? null,
      city: team.city ?? null,
      state: team.state ?? null,
      teamName: team.teamName ?? null,
      teamCode: team.teamCode,
      slug: team.slug,
      teamColors: team.teamColors,
      primaryColorHex: team.primaryColorHex ?? null,
      secondaryColorHex: team.secondaryColorHex ?? null,
      colorFamilies: team.colorFamilies,
      colorVerificationStatus: team.colorVerificationStatus ?? null,
      printVerificationStatus: team.printVerificationStatus ?? null,
      stadiumName: team.stadiumName ?? null,
      teamSaying: team.teamSaying ?? null,
      fanPhrase: team.fanPhrase ?? null,
      tags: Array.isArray(team.tags) ? team.tags : [],
      region: Array.isArray(team.region) ? team.region : [],
      rivals: Array.isArray(team.rivals) ? team.rivals : [],
      mascot: team.mascot ?? null,
      hashtags: Array.isArray(team.hashtags) ? team.hashtags : [],
      fanPhrases: Array.isArray(team.fanPhrases) ? team.fanPhrases : [],
      updatedAt: now,
    };

    if (!existingSnap.exists) {
      await teamRef.set({ ...doc, createdAt: now });
      results.push({ id: team.id, status: "created" });
    } else if (merge) {
      const existing = existingSnap.data() || {};
      await teamRef.set({ ...doc, createdAt: existing.createdAt || now }, { merge: true });
      results.push({ id: team.id, status: "merged" });
    } else {
      results.push({ id: team.id, status: "skipped", reason: "already exists" });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const merged = results.filter((r) => r.status === "merged").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log(
    "[seedDesignTeamsCanonicalPhase1]",
    created,
    "created,",
    merged,
    "merged,",
    skipped,
    "skipped"
  );

  return {
    ok: true,
    countsByLeague,
    total: teams.length,
    created,
    merged,
    skipped,
    results,
  };
});

/** Optional design series / campaign slug: lowercase snake_case */
function normalizeDesignSeriesInput(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  const out = s
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return out || null;
}

/**
 * Create a new Design (reusable artwork metadata)
 * Required: name, teamId, designType, colors (at least one hex color)
 */
exports.createDesignAsset = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  const adminRole = adminSnap.data()?.role;
  if (!adminSnap.exists || (adminRole !== "admin" && adminRole !== "ops")) {
    throw new functions.https.HttpsError("permission-denied", "Only admins and ops can create designs");
  }

  const {
    name,
    teamId,
    colors,
    designType,
    designSeries,
    internalNotes,
    tags,
    description,
    slugOverride,
    importKey,
    sportCode,
    leagueCode,
    teamCode: teamCodeIn,
    themeCode,
    designFamily,
    importSource,
    importBatchId,
    importVersion,
  } = data;

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "name is required");
  }

  if (!teamId || typeof teamId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "teamId is required");
  }

  if (!designType || typeof designType !== "string" || !isAllowedDesignTheme(designType)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "designType (design theme) is required and must be a canonical theme: city_69, slogan, stadium, rivalry, number, wordplay, badge_crest, pillows, custom_one_off (or a legacy value: wordmark, script, badge, other)"
    );
  }

  // Validate colors (at least one hex color required)
  if (!colors || !Array.isArray(colors) || colors.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "At least one color is required");
  }

  // Validate each color hex
  for (const color of colors) {
    if (!color.hex || !HEX_COLOR_REGEX.test(color.hex)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid hex color: ${color.hex}. Must be #RRGGBB format.`
      );
    }
  }

  // Verify team exists
  const teamSnap = await db.collection("design_teams").doc(teamId).get();
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Team not found: ${teamId}`);
  }

  const teamData = teamSnap.data();
  const teamName = teamData.name || teamId;
  const leagueId = teamData.leagueId || teamData.league || null;
  const teamCity = teamData.city || null;
  const teamState = teamData.state || null;
  const teamNickname = teamData.teamName || null;

  // Slug: optional bulk identity slug, else team + name + uniqueness
  let slug;
  if (slugOverride && typeof slugOverride === "string" && slugOverride.trim()) {
    const base = slugOverride.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    let candidate = base;
    const dup = await db.collection("designs").where("slug", "==", candidate).limit(1).get();
    slug = dup.empty ? candidate : `${candidate}-${Date.now().toString(36)}`;
  } else {
    const slugBase = `${teamName}-${name}`.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    slug = `${slugBase}-${Date.now().toString(36)}`;
  }

  // Normalize colors + Rally standard Off Black / Off White + CMYK on every swatch
  const normalizedColors = normalizeColorsForFirestore(colors);

  const tagList = Array.isArray(tags) ? tags : [];
  const internal =
    internalNotes !== undefined && internalNotes !== null
      ? String(internalNotes).trim() || null
      : description !== undefined && description !== null
        ? String(description).trim() || null
        : null;

  const seriesNorm = normalizeDesignSeriesInput(designSeries);

  // Generate search keywords (no product/SEO copy)
  const searchKeywords = [
    name.toLowerCase(),
    teamName.toLowerCase(),
    teamId.toLowerCase(),
    designType,
    seriesNorm,
    leagueId && String(leagueId).toLowerCase(),
    teamCity && String(teamCity).toLowerCase(),
    teamState && String(teamState).toLowerCase(),
    teamNickname && String(teamNickname).toLowerCase(),
    ...tagList.map(t => String(t).toLowerCase()),
    ...normalizedColors.map(c => c.name?.toLowerCase()).filter(Boolean),
    ...normalizedColors.map(c => c.hex.toLowerCase()),
    ...normalizedColors.map(c => (c.role && String(c.role).toLowerCase())),
  ].filter(Boolean);

  const now = admin.firestore.FieldValue.serverTimestamp();

  const files = {
    lightPng: null,
    darkPng: null,
    png: null,
    lightSvg: null,
    darkSvg: null,
    svg: null,
    lightPdf: null,
    darkPdf: null,
    pdf: null,
  };

  const assets = {
    lightPng: null,
    darkPng: null,
    lightSvg: null,
    darkSvg: null,
    svg: null,
    lightPdf: null,
    darkPdf: null,
    pdf: null,
  };

  const teamCodeDenorm = teamData.teamCode || teamCodeIn || null;

  const designData = {
    name: name.trim(),
    slug,
    teamId,
    teamNameCache: teamName,
    teamCode: teamCodeDenorm,
    leagueId,
    teamCityCache: teamCity,
    teamStateCache: teamState,
    teamNicknameCache: teamNickname,
    designType,
    designSeries: seriesNorm,
    status: "draft",
    tags: tagList,
    description: null,
    internalNotes: internal,
    files,
    assets,
    colors: normalizedColors,
    colorCount: normalizedColors.length,
    placementDefaults: DEFAULT_DESIGN_PLACEMENTS,
    linkedBlankVariantCount: 0,
    linkedProductCount: 0,
    hasSvg: false,
    hasLightPng: false,
    hasDarkPng: false,
    hasWhitePng: false,
    hasPng: false,
    hasPdf: false,
    isComplete: false,
    searchKeywords,
    createdAt: now,
    updatedAt: now,
    createdByUid: userId,
    updatedByUid: userId,
  };

  if (importKey !== undefined) designData.importKey = importKey || null;
  if (sportCode !== undefined) designData.sportCode = sportCode || null;
  if (leagueCode !== undefined) designData.leagueCode = leagueCode || null;
  if (themeCode !== undefined) designData.themeCode = themeCode || null;
  if (designFamily !== undefined) designData.designFamily = designFamily || null;
  if (importSource !== undefined) designData.importSource = importSource || null;
  if (importBatchId !== undefined) designData.importBatchId = importBatchId || null;
  if (importVersion !== undefined) designData.importVersion = importVersion || null;

  const designRef = await db.collection("designs").add(designData);

  // Update the id field
  await designRef.update({ id: designRef.id });

  console.log("[createDesignAsset] Created design:", designRef.id, slug);

  return {
    ok: true,
    designId: designRef.id,
    slug,
  };
});

/**
 * Update Design file metadata (PNG or PDF)
 * Called after a successful storage upload
 */
exports.updateDesignFile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  const adminRoleUdf = adminSnap.data()?.role;
  if (!adminSnap.exists || (adminRoleUdf !== "admin" && adminRoleUdf !== "ops")) {
    throw new functions.https.HttpsError("permission-denied", "Only admins and ops can update design files");
  }

  const { designId, kind, storagePath, downloadUrl, fileName, contentType, sizeBytes, widthPx, heightPx, sha256 } = data;

  // Validate required fields
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }

  if (!kind || !DESIGN_FILE_KINDS.has(kind)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "kind must be a supported design file kind (includes side-aware: frontLightPng, backDarkPng, …)"
    );
  }

  if (!storagePath || !downloadUrl || !fileName) {
    throw new functions.https.HttpsError("invalid-argument", "storagePath, downloadUrl, and fileName are required");
  }

  // Verify design exists
  const designRef = db.collection("designs").doc(designId);
  const designSnap = await designRef.get();
  if (!designSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Design not found");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  const isRasterPng = isRasterPngKind(kind);
  const isSvgFamily = isSvgFamilyKind(kind);
  const fileKindForDoc = isRasterPng ? "png" : isSvgFamily ? "svg" : "pdf";

  const fileData = {
    kind: fileKindForDoc,
    storagePath,
    downloadUrl,
    fileName,
    contentType:
      contentType ||
      (isRasterPng ? "image/png" : isSvgFamily ? "image/svg+xml" : "application/pdf"),
    sizeBytes: sizeBytes || 0,
    widthPx: isRasterPng ? (widthPx || null) : null,
    heightPx: isRasterPng ? (heightPx || null) : null,
    sha256: sha256 || null,
    uploadedAt: now,
    uploadedByUid: userId,
  };

  const fileEntry = { ...fileData, downloadUrl };

  const currentData = designSnap.data();
  const mergedFiles = mergeDesignFiles(currentData.files || {}, kind, fileEntry);

  const mergedAssets = buildAssetsFromFiles(mergedFiles);

  const hasSvg = !!(
    mergedFiles.svg ||
    mergedFiles.lightSvg ||
    mergedFiles.darkSvg ||
    mergedFiles.whiteSvg ||
    mergedFiles.front?.lightSvg ||
    mergedFiles.front?.darkSvg ||
    mergedFiles.front?.whiteSvg ||
    mergedFiles.back?.lightSvg ||
    mergedFiles.back?.darkSvg ||
    mergedFiles.back?.whiteSvg
  );
  const hasPdf = !!(
    mergedFiles.pdf ||
    mergedFiles.lightPdf ||
    mergedFiles.darkPdf ||
    mergedFiles.whitePdf ||
    mergedFiles.front?.lightPdf ||
    mergedFiles.front?.darkPdf ||
    mergedFiles.front?.whitePdf ||
    mergedFiles.back?.lightPdf ||
    mergedFiles.back?.darkPdf ||
    mergedFiles.back?.whitePdf
  );
  const { hasLightPng, hasDarkPng, hasWhitePng, hasPng } = computeDesignPngFlags(mergedFiles, mergedAssets);

  const updateData = {
    files: mergedFiles,
    assets: mergedAssets,
    updatedAt: now,
    updatedByUid: userId,
  };

  updateData.hasSvg = hasSvg;
  updateData.hasLightPng = hasLightPng;
  updateData.hasDarkPng = hasDarkPng;
  updateData.hasWhitePng = hasWhitePng;
  updateData.hasPng = hasPng;
  updateData.hasPdf = hasPdf;

  const nextForComplete = {
    ...currentData,
    files: mergedFiles,
    assets: mergedAssets,
    colorCount: currentData.colorCount,
  };
  updateData.isComplete = computeDesignIsComplete(nextForComplete);

  await designRef.update(updateData);

  console.log("[updateDesignFile] Updated design file:", designId, kind);

  return { ok: true };
});

/**
 * Update Design metadata (status, colors, tags, etc.)
 */
exports.updateDesignAsset = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  const adminRoleUda = adminSnap.data()?.role;
  if (!adminSnap.exists || (adminRoleUda !== "admin" && adminRoleUda !== "ops")) {
    throw new functions.https.HttpsError("permission-denied", "Only admins and ops can update designs");
  }

  const {
    designId,
    status,
    colors,
    tags,
    description,
    name,
    slug,
    sportCode,
    leagueCode,
    teamCode,
    themeCode,
    designFamily,
    designType,
    designSeries,
    internalNotes,
    leagueId,
    supportedSides,
  } = data;

  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }

  // Verify design exists
  const designRef = db.collection("designs").doc(designId);
  const designSnap = await designRef.get();
  if (!designSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Design not found");
  }

  const currentData = designSnap.data();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const updateData = {
    updatedAt: now,
    updatedByUid: userId,
  };

  // Status update
  if (status && ["draft", "active", "archived"].includes(status)) {
    updateData.status = status;
  }

  // Name update
  if (name && typeof name === "string" && name.trim().length > 0) {
    updateData.name = name.trim();
  }

  if (slug !== undefined && typeof slug === "string" && slug.trim().length > 0) {
    updateData.slug = slug.trim();
  }

  // Description (legacy) / internal notes
  if (description !== undefined) {
    updateData.description = description || null;
  }
  if (internalNotes !== undefined) {
    updateData.internalNotes = internalNotes || null;
  }

  if (designType !== undefined) {
    if (designType === null || designType === "") {
      updateData.designType = null;
    } else if (!isAllowedDesignTheme(designType)) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid designType (design theme)");
    } else {
      updateData.designType = designType;
    }
  }

  if (leagueId !== undefined) {
    updateData.leagueId = leagueId || null;
  }

  // Tags update
  if (tags && Array.isArray(tags)) {
    updateData.tags = tags;
  }

  // Taxonomy (optional; null clears)
  if (sportCode !== undefined) updateData.sportCode = sportCode || null;
  if (leagueCode !== undefined) updateData.leagueCode = leagueCode || null;
  if (teamCode !== undefined) updateData.teamCode = teamCode || null;
  if (themeCode !== undefined) updateData.themeCode = themeCode || null;
  if (designFamily !== undefined) updateData.designFamily = designFamily || null;

  if (designSeries !== undefined) {
    updateData.designSeries = normalizeDesignSeriesInput(designSeries);
  }

  if (supportedSides !== undefined) {
    if (supportedSides === null) {
      updateData.supportedSides = admin.firestore.FieldValue.delete();
    } else if (Array.isArray(supportedSides)) {
      const allowed = new Set(["front", "back"]);
      const cleaned = [
        ...new Set(
          supportedSides
            .map((s) => String(s).trim().toLowerCase())
            .filter((s) => allowed.has(s))
        ),
      ];
      updateData.supportedSides =
        cleaned.length > 0 ? cleaned : admin.firestore.FieldValue.delete();
    }
  }

  // Colors update
  if (colors && Array.isArray(colors)) {
    // Validate colors
    if (colors.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "At least one color is required");
    }

    for (const color of colors) {
      if (!color.hex || !HEX_COLOR_REGEX.test(color.hex)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `Invalid hex color: ${color.hex}. Must be #RRGGBB format.`
        );
      }
    }

    const normalizedColors = normalizeColorsForFirestore(colors);

    updateData.colors = normalizedColors;
    updateData.colorCount = normalizedColors.length;
  }

  // Regenerate search keywords (never call .toLowerCase on null/undefined — that caused INTERNAL 500s)
  const kwLower = (v) => {
    if (v == null || v === "") return null;
    return String(v).toLowerCase();
  };
  const finalName = updateData.name || currentData.name;
  const finalTags = updateData.tags || currentData.tags || [];
  const finalColors = updateData.colors || currentData.colors || [];
  const teamName = currentData.teamNameCache || currentData.teamId;
  const finalDesignType = updateData.designType !== undefined ? updateData.designType : currentData.designType;
  const finalLeague = updateData.leagueId !== undefined ? updateData.leagueId : currentData.leagueId;
  const finalSeries =
    updateData.designSeries !== undefined ? updateData.designSeries : currentData.designSeries;

  updateData.searchKeywords = [
    kwLower(finalName),
    kwLower(teamName),
    kwLower(currentData.teamId),
    finalDesignType != null && finalDesignType !== "" ? String(finalDesignType).toLowerCase() : null,
    finalSeries != null && finalSeries !== "" ? String(finalSeries).toLowerCase() : null,
    finalLeague != null && finalLeague !== "" ? String(finalLeague).toLowerCase() : null,
    currentData.teamCityCache != null ? String(currentData.teamCityCache).toLowerCase() : null,
    currentData.teamStateCache != null ? String(currentData.teamStateCache).toLowerCase() : null,
    currentData.teamNicknameCache != null ? String(currentData.teamNicknameCache).toLowerCase() : null,
    ...finalTags.map((t) => kwLower(t)).filter(Boolean),
    ...finalColors.map((c) => kwLower(c.name)).filter(Boolean),
    ...finalColors.map((c) => (c.hex != null ? String(c.hex).toLowerCase() : null)).filter(Boolean),
    ...finalColors.map((c) => (c.role != null && c.role !== "" ? String(c.role).toLowerCase() : null)).filter(Boolean),
  ].filter(Boolean);

  // Update completion status (merged files + metadata). Do not pass Firestore FieldValue sentinels
  // (e.g. supportedSides: delete()) into computeDesignIsComplete — that crashes URL resolution.
  const merged = {
    ...currentData,
    ...updateData,
    files: { ...(currentData.files || {}), ...(updateData.files || {}) },
    colorCount: updateData.colorCount !== undefined ? updateData.colorCount : currentData.colorCount,
    designType: finalDesignType,
    teamId: currentData.teamId,
    status: updateData.status !== undefined ? updateData.status : currentData.status,
    supportedSides: effectiveSupportedSidesAfterUpdate(supportedSides, currentData.supportedSides),
  };

  try {
    updateData.isComplete = computeDesignIsComplete(merged);
  } catch (e) {
    console.error("[updateDesignAsset] computeDesignIsComplete failed:", e);
    updateData.isComplete = false;
  }

  try {
    const payload = {};
    for (const [k, v] of Object.entries(updateData)) {
      if (v !== undefined) payload[k] = v;
    }
    await designRef.update(payload);
  } catch (e) {
    console.error("[updateDesignAsset] Firestore update failed:", e);
    throw new functions.https.HttpsError(
      "failed-precondition",
      e && e.message ? String(e.message) : "Firestore update failed"
    );
  }

  console.log("[updateDesignAsset] Updated design:", designId);

  return { ok: true };
});

/**
 * Get all design teams
 */
exports.getDesignTeams = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const teamsSnap = await db.collection("design_teams").orderBy("name").get();
  
  const teams = teamsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  return { ok: true, teams };
});

// ============================================================================
// Product Mock Generation System — Deterministic Renderer (Phase 1)
// Aligned with RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER.md
// ============================================================================

// Phase 1: deterministic only. Set to false to enable optional AI realism pass (Phase 2).
const MOCK_PHASE1_DETERMINISTIC_ONLY = process.env.MOCK_PHASE1_DETERMINISTIC_ONLY !== "false";

// Default placement values (normalized 0-1). Blanks may provide printArea: { x, y, width, height }.
// Per RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER: soft-light for print-on-fabric + 90% opacity; premultiplied alpha for correct blend.
const DEFAULT_MOCK_PLACEMENT = {
  x: 0.5,
  y: 0.5,
  scale: 0.6,
  safeArea: { padX: 0.2, padY: 0.2 },
  rotationDeg: 0,
  blendMode: "soft-light",
  blendOpacity: 0.9,
};

/** Apply opacity to an RGBA buffer (0-1). Used for blend integration (e.g. 80-90% for heather). */
function applyOpacityToRgbaBuffer(buffer, width, height, opacity) {
  const b = Buffer.from(buffer);
  for (let i = 3; i < b.length; i += 4) {
    b[i] = Math.round(b[i] * opacity);
  }
  return b;
}

/** Premultiply alpha (R,G,B *= A/255). Required for correct blending in Sharp composite (overlay/soft-light). */
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

/** Alpha threshold for considering a pixel "visible" when detecting artwork bounds (avoid dust/noise). */
const ARTWORK_BOUNDS_ALPHA_THRESHOLD = 5;

/**
 * Detect visible artwork bounds in a design PNG and crop to that region.
 * Makes the renderer resilient to padded PNGs (RALLY_FIX_DESIGN_PNG_PADDING_AND_RENDERER_BOUNDS).
 * Returns { buffer, width, height } — either cropped to artwork bounds or original if detection fails.
 */
async function cropDesignToArtworkBounds(designBuffer, alphaThreshold = ARTWORK_BOUNDS_ALPHA_THRESHOLD) {
  const sharp = require("sharp");
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
      if (a > alphaThreshold) {
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

/**
 * Auto-generate a blank print-zone mask via SAM (fal.ai). Spec: RALLY_BLANK_MASK_AI_AUTOGEN.md.
 * Returns a preview URL; commit with `commitBlankMaskFromPreview`.
 */
exports.generateBlankMaskViaSam = functions
  .runWith({ memory: "1GB", timeoutSeconds: 120 })
  .https.onCall(buildGenerateBlankMaskViaSam({ db, storage, functions, sharp: require("sharp") }));

/**
 * Promote an AI-generated preview to the canonical mask and write `rp_blank_masks/{blankId}_{view}`.
 */
exports.commitBlankMaskFromPreview = functions
  .runWith({ memory: "512MB", timeoutSeconds: 60 })
  .https.onCall(buildCommitBlankMaskFromPreview({ db, admin, storage, functions, sharp: require("sharp") }));

/**
 * Blank-level real-render preview. Runs the same Stage A Sharp compose `onMockJobCreated`
 * uses (with the rp_blank_masks multiply step), but takes placement/blend from the caller
 * so the editor can preview unsaved changes. Spec: RALLY_BLANK_PREVIEW_RENDER.md.
 */
exports.previewBlankRender = functions
  .runWith({ memory: "2GB", timeoutSeconds: 60 })
  .https.onCall(buildPreviewBlankRender({ db, storage, functions, sharp: require("sharp"), admin }));

/**
 * Async drain for `rp_blank_preview_jobs` — runs the compose pipeline outside the
 * synchronous callable gateway so Stage B can take its full ~30–60s without timing
 * out the client. Spec: RALLY_BLANK_PREVIEW_RENDER.md §5.
 */
exports.onBlankPreviewJobCreated = functions
  .runWith({ memory: "2GB", timeoutSeconds: 540 })
  .firestore.document("rp_blank_preview_jobs/{jobId}")
  .onCreate(buildOnBlankPreviewJobCreated({ db, storage, admin, functions, sharp: require("sharp") }));

/**
 * Phase B A/B harness: fan out N rp_blank_preview_jobs from one input, one
 * per VTON provider, all sharing an `abTestGroupId`. Used by the
 * compare-providers UI to render side-by-side realism outputs for the same
 * design + blank + variant.
 *
 * Input:  { blankId, variantId, designId, view, renderTarget, placement,
 *           artworkMode?, designUrlOverride?, providerIds: string[] }
 * Output: { abTestGroupId, jobIds: { [providerId]: jobId }, providerCount }
 */
exports.enqueueVtonAbTest = functions.https.onCall(
  buildEnqueueVtonAbTest({ db, functions, admin })
);

/**
 * Phase C: enqueue a single Kontext scene render. Generates a lifestyle /
 * studio / gameday variation of an existing product render via Flux Kontext.
 *
 * Input:  { productId, variantId, sourceSlot, sourceUrlOverride?, sceneTemplateId }
 * Output: { jobId, status: "queued" }
 *
 * The async trigger (onSceneJobCreated) drains the rp_scene_jobs collection
 * and writes the result to variant.sceneRenders[templateId] plus the job
 * doc's result field.
 */
exports.enqueueSceneJob = functions.https.onCall(
  buildEnqueueSceneJob({ db, functions, admin })
);

/**
 * Phase C: 4-shot PDP batch generator. Fans out N scene jobs (default: 4
 * curated templates) from one variant + source slot, sharing a sceneSetId
 * so the UI can subscribe to the whole set with one Firestore query.
 *
 * Input:  { productId, variantId, sourceSlot, sourceUrlOverride?, sceneTemplateIds?: string[] }
 * Output: { sceneSetId, jobIds: { [templateId]: jobId }, templateCount }
 */
exports.enqueueSceneJobBatch = functions.https.onCall(
  buildEnqueueSceneJobBatch({ db, functions, admin })
);

/**
 * Phase C trigger: drains rp_scene_jobs. Calls Kontext via runFalInference,
 * saves the resulting PNG to Storage, writes back to
 * variant.sceneRenders[templateId], stamps cost telemetry on the job doc.
 */
exports.onSceneJobCreated = functions
  .runWith({ memory: "2GB", timeoutSeconds: 540 })
  .firestore.document("rp_scene_jobs/{jobId}")
  .onCreate(
    buildOnSceneJobCreated({ db, storage, admin, functions, sharp: require("sharp") })
  );

/**
 * Phase E: per-job progress triggers that update the parent rp_batches doc
 * when a child job's status changes. Two onWrite triggers (one per child
 * collection) share the same factory — same status-rollup semantics for
 * scene_set and vton_ab batches.
 *
 * onWrite (not onUpdate): we need to see the initial status==="queued"
 * create event to ignore it (the parent batch's `queued` counter was
 * already set at fan-out time). The factory short-circuits the no-op case.
 */
exports.onSceneJobBatchProgress = functions.firestore
  .document("rp_scene_jobs/{jobId}")
  .onWrite(buildOnJobBatchProgress({ db, admin, label: "scene_job" }));

exports.onBlankPreviewJobBatchProgress = functions.firestore
  .document("rp_blank_preview_jobs/{jobId}")
  .onWrite(buildOnJobBatchProgress({ db, admin, label: "preview_job" }));

/**
 * Phase I: identity reference-image management. Client uploads the image to
 * Cloud Storage at rp/identity_references/{identityId}/... via the client SDK,
 * then calls these to register the reference on the rp_identities doc.
 *
 *   addIdentityReferenceImage    → append { refId, url, role, ... }
 *   removeIdentityReferenceImage → remove by refId + best-effort Storage delete
 *   setIdentityMode              → switch lora/reference_images/hybrid +
 *                                  optional preferredProviderId
 */
exports.addIdentityReferenceImage = functions.https.onCall(
  buildAddIdentityReferenceImage({ db, admin, functions, storage })
);
exports.removeIdentityReferenceImage = functions.https.onCall(
  buildRemoveIdentityReferenceImage({ db, admin, functions, storage })
);
exports.setIdentityMode = functions.https.onCall(
  buildSetIdentityMode({ db, admin, functions })
);

/**
 * Phase L: persist the model print quad (4 chest-plane corners) on a blank
 * variant so composeStageA can perspective-warp designs onto the angled
 * model photo deterministically. Input: { blankId, variantId, side, quad } or
 * { blankId, variantId, side, clear: true }.
 */
exports.saveModelPrintQuad = functions.https.onCall(
  buildSaveModelPrintQuad({ db, admin, functions })
);

/**
 * Phase 3: enqueue a model-realism render for a product variant. Wraps the
 * Phase 2 `rp_blank_preview_jobs` flow with a product binding — when complete,
 * the trigger writes the realism URL onto the variant's flatRenders slot.
 *
 * Input:  { productId, blankVariantId, view: "front" | "back", withRealism?, artworkMode? }
 * Output: { jobId, status: "queued", officialRole }
 */
exports.enqueueProductModelRealism = functions.https.onCall(
  buildEnqueueProductModelRealism({ db, admin, functions })
);

/**
 * Phase 3e: fan-out — one click on the product page enqueues a model-realism
 * render per (color, side with a model photo). Returns the list of jobs +
 * skipped (color, side) combos so the UI can show aggregate progress.
 *
 * Input:  { productId, sides?, withRealism?, artworkMode? }
 * Output: { jobs: [...], skipped: [...] }
 */
exports.enqueueProductModelRealismBatch = functions
  .runWith({ memory: "512MB", timeoutSeconds: 60 })
  .https.onCall(buildEnqueueProductModelRealismBatch({ db, admin, functions }));

/**
 * Create a mock generation job
 * Input: { designId, blankId, view, quality }
 * Returns: { jobId }
 */
exports.createMockJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { resolveEffectivePlacement } = require("./lib/resolveProductRenderProfile");

  const {
    designId,
    blankId,
    view = "front",
    placementId: inputPlacementId,
    quality = "draft",
    productId,
    productVariantId,
    heroSlot,
    blankImageUrl: inputBlankUrl,
    designPngUrl: inputDesignUrl,
    placementOverride: inputPlacementOverride,
  } = data;

  // Validate required fields
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }
  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }
  if (!["front", "back"].includes(view)) {
    throw new functions.https.HttpsError("invalid-argument", "view must be 'front' or 'back'");
  }
  if (!["draft", "final"].includes(quality)) {
    throw new functions.https.HttpsError("invalid-argument", "quality must be 'draft' or 'final'");
  }

  // Fetch the design (needed for placement even when explicit designPngUrl is provided)
  const designRef = db.collection("designs").doc(designId);
  const designSnap = await designRef.get();
  if (!designSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
  }
  const design = designSnap.data();

  // Use explicit design URL when provided (Render Setup UI), else design PNG
  let designPngUrl = typeof inputDesignUrl === "string" && inputDesignUrl ? inputDesignUrl : null;
  if (!designPngUrl) {
    designPngUrl = designPngUrlForProcessing(design);
    if (!designPngUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Design must have a PNG file uploaded (light/dark or legacy PNG)"
      );
    }
  }

  // Fetch the blank (needed for placement even when explicit blankImageUrl is provided)
  const blankRef = db.collection("rp_blanks").doc(blankId);
  const blankSnap = await blankRef.get();
  if (!blankSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
  }
  const blank = blankSnap.data();

  // Use explicit blank URL when provided (Render Setup UI), else blank view image
  let blankImageUrl = typeof inputBlankUrl === "string" && inputBlankUrl ? inputBlankUrl : null;
  if (!blankImageUrl) {
    const viewImage = blank.images?.[view];
    if (!viewImage?.downloadUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Blank must have a ${view} image uploaded`
      );
    }
    blankImageUrl = viewImage.downloadUrl;
  }

  // Resolve placement (use input if valid for view, else default)
  const validPlacements = view === "front"
    ? ["front_center", "front_left", "front_right"]
    : ["back_center", "back_left", "back_right"];
  const placementId = (inputPlacementId && validPlacements.includes(inputPlacementId))
    ? inputPlacementId
    : (view === "front" ? "front_center" : "back_center");
  
  // Try to get placement from blank, then from design, then use default
  let placement = DEFAULT_MOCK_PLACEMENT;
  
  // Check blank placements first (supports printArea per RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER)
  const blankPlacement = blank.placements?.find(p => p.placementId === placementId);
  if (blankPlacement) {
    const printArea = blankPlacement.printArea || {};
    const safeArea = blankPlacement.safeArea || {};
    /**
     * Option A safeArea sizing (RALLY_BLANK_PREVIEW_RENDER.md follow-up): if `printArea`
     * doesn't set width/height, use the zone's `safeArea.w/h` as the print-zone size so
     * the design is sized relative to the printable region. The legacy fallback
     * (`0.5 × blank × scale` in onMockJobCreated) only triggers when neither is set —
     * effectively unreachable now for blanks with a safeArea.
     */
    /**
     * Surface the blank's `blendSettings.fabricFeel` / `printStrength` (the editor
     * preview "Fabric feel" / "Print strength" sliders persist into the blank doc) so
     * the Stage B v10 realism pass in `onMockJobCreated` can read the same values the
     * editor preview uses. Falls back to {0.5, 0.7} downstream when unset.
     */
    const blendSettings = blank.blendSettings || {};
    placement = {
      x: printArea.x ?? blankPlacement.defaultX ?? placement.x,
      y: printArea.y ?? blankPlacement.defaultY ?? placement.y,
      width: printArea.width ?? safeArea.w,
      height: printArea.height ?? safeArea.h,
      scale: blankPlacement.defaultScale ?? placement.scale,
      safeArea: blankPlacement.safeArea ?? placement.safeArea,
      rotationDeg: 0,
      blendMode: blankPlacement.blendMode ?? "multiply",
      blendOpacity: blankPlacement.blendOpacity ?? 0.87,
      // Operator's chosen clip strategy — read by onMockJobCreated to gate mask application.
      maskConfig: blankPlacement.maskConfig ?? null,
      fabricFeel:
        Number.isFinite(Number(blankPlacement.fabricFeel))
          ? Number(blankPlacement.fabricFeel)
          : Number.isFinite(Number(blendSettings.fabricFeel))
            ? Number(blendSettings.fabricFeel)
            : null,
      printStrength:
        Number.isFinite(Number(blankPlacement.printStrength))
          ? Number(blankPlacement.printStrength)
          : Number.isFinite(Number(blendSettings.printStrength))
            ? Number(blendSettings.printStrength)
            : null,
    };
  }

  // Check design placements as fallback
  const designPlacement = design.placementDefaults?.find(p => p.placementId === placementId);
  if (!blankPlacement && designPlacement) {
    placement = {
      ...placement,
      x: designPlacement.x ?? placement.x,
      y: designPlacement.y ?? placement.y,
      scale: designPlacement.scale ?? placement.scale,
      safeArea: designPlacement.safeArea ?? placement.safeArea,
      rotationDeg: designPlacement.rotationDeg ?? 0,
    };
  }

  // Product inherits blank placement unless placementOverrides / legacy renderSetup override (see resolveProductRenderProfile)
  if (productId && typeof productId === "string") {
    try {
      const prodSnap = await db.collection("rp_products").doc(productId).get();
      if (prodSnap.exists) {
        const prodData = prodSnap.data();
        let placementSource = prodData;
        if (prodData.productKind === "parent" && productVariantId && typeof productVariantId === "string") {
          const vSnap = await db
            .collection("rp_products")
            .doc(productId)
            .collection("variants")
            .doc(productVariantId)
            .get();
          if (vSnap.exists) {
            placementSource = vSnap.data();
          }
        }
        const blankVariantIdForPlacement =
          (placementSource && placementSource.blankVariantId) || (prodData && prodData.blankVariantId) || null;
        const blankVariantRow =
          blankVariantIdForPlacement && Array.isArray(blank.variants)
            ? blank.variants.find((v) => v && v.variantId === blankVariantIdForPlacement) || null
            : null;
        const eff = resolveEffectivePlacement(placementSource, blank, view, blankVariantRow);
        if (eff) {
          placement.x = eff.defaultX;
          placement.y = eff.defaultY;
          placement.scale = eff.defaultScale;
          placement.safeArea = eff.safeArea;
        }
      }
    } catch (e) {
      console.warn("[createMockJob] Could not merge product placement:", e && e.message);
    }
  }

  // Explicit per-request override (advanced / UI drag)
  if (inputPlacementOverride && typeof inputPlacementOverride === "object") {
    if (typeof inputPlacementOverride.x === "number") placement.x = inputPlacementOverride.x;
    if (typeof inputPlacementOverride.y === "number") placement.y = inputPlacementOverride.y;
    if (typeof inputPlacementOverride.scale === "number") placement.scale = inputPlacementOverride.scale;
    if (typeof inputPlacementOverride.width === "number") placement.width = inputPlacementOverride.width;
    if (typeof inputPlacementOverride.height === "number") placement.height = inputPlacementOverride.height;
  }
  console.log("[createMockJob] Resolved placement: x=" + placement.x + ", y=" + placement.y + ", scale=" + placement.scale + (placement.width != null ? ", width=" + placement.width + ", height=" + placement.height : " (no printArea)"));

  // Create the job document (optional productId: link mockup to product; optional heroSlot: create product asset and set product.media.heroFront/heroBack)
  const jobData = {
    designId,
    blankId,
    view,
    placementId,
    quality,
    productId: productId || null,
    productVariantId: productVariantId || null,
    heroSlot: (heroSlot === "hero_front" || heroSlot === "hero_back") ? heroSlot : null,
    input: {
      blankImageUrl,
      designPngUrl,
      placement,
    },
    output: {},
    attempts: 0,
    status: "queued",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: context.auth.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const sanitized = sanitizeForFirestore(jobData);
  const jobRef = await db.collection("rp_mock_jobs").add(sanitized);
  
  console.log("[createMockJob] Created job:", jobRef.id);

  return { ok: true, jobId: jobRef.id };
});

/**
 * Worker: onMockJobCreated — Deterministic product mock engine (Phase 1)
 * Pipeline per RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER.md:
 *   Load blank → [optional fabric mask: design × mask] → scale design → position → multiply blend + opacity → export packshot
 * Stage A: Exact composite (always). Stage B: AI realism (only when quality=final and not MOCK_PHASE1_DETERMINISTIC_ONLY).
 */
exports.onMockJobCreated = functions
  .runWith({ memory: "2GB", timeoutSeconds: 300 })
  .firestore.document("rp_mock_jobs/{jobId}")
  .onCreate(async (snap, ctx) => {
    const sharp = require("sharp");
    
    const jobId = ctx.params.jobId;
    const job = snap.data();
    const jobRef = db.collection("rp_mock_jobs").doc(jobId);

    console.log("[onMockJobCreated] Processing job:", jobId);

    try {
      // Update status to processing
      await jobRef.update({
        status: "processing",
        attempts: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const { designId, blankId, view, placementId, quality, input } = job;
      const { blankImageUrl, designPngUrl, placement } = input;

      let heroAssetId = null;
      let heroAssetUrl = null;

      // --- Stage A: Deterministic composite ---
      
      // Fetch the blank image
      console.log("[onMockJobCreated] Fetching blank image:", blankImageUrl);
      const blankResp = await fetch(blankImageUrl);
      if (!blankResp.ok) {
        throw new Error(`Failed to fetch blank image: ${blankResp.status}`);
      }
      const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

      // Fetch the design PNG
      console.log("[onMockJobCreated] Fetching design PNG:", designPngUrl);
      const designResp = await fetch(designPngUrl);
      if (!designResp.ok) {
        throw new Error(`Failed to fetch design PNG: ${designResp.status}`);
      }
      let designBuffer = Buffer.from(await designResp.arrayBuffer());

      // Use the design PNG's NATURAL dimensions. We previously cropped to artwork bounds
      // (RALLY_FIX_DESIGN_PNG_PADDING_AND_RENDERER_BOUNDS), but that produced a different
      // visual layout from the editor's CSS canvas, which shows the full uncropped artboard
      // with object-contain. Aligning production with the editor preview means "what you
      // see is what you ship." Designers should tightly crop their artboards before upload.
      // Aligned with composeStageA in functions/lib/blankPreviewRender.js.
      const designMetaOriginal = await sharp(designBuffer).metadata();
      const designWidth = designMetaOriginal.width || 1;
      const designHeight = designMetaOriginal.height || 1;
      console.log("[onMockJobCreated] Design PNG: natural", designWidth, "x", designHeight, "(no artwork-bounds crop)");

      // Get blank image dimensions
      const blankMeta = await sharp(blankBuffer).metadata();
      const blankWidth = blankMeta.width;
      const blankHeight = blankMeta.height;
      console.log("[onMockJobCreated] Blank dimensions:", blankWidth, "x", blankHeight);

      // Placement: support printArea (x, y, width, height) normalized 0-1 per spec, or legacy (x, y, scale, safeArea).
      // x,y are always "center of design" (match Edit placement modal); scale sizes the art box.
      const { x, y, scale, safeArea, width: placementWidth, height: placementHeight } = placement;
      const effectiveScale = scale ?? 0.6;
      const centerXpx = Math.round((x ?? 0.5) * blankWidth);
      const centerYpx = Math.round((y ?? 0.5) * blankHeight);
      let artBoxPxW, artBoxPxH, left, top;
      if (placementWidth != null && placementHeight != null && placementWidth > 0 && placementHeight > 0) {
        const fullPrintW = blankWidth * placementWidth;
        const fullPrintH = blankHeight * placementHeight;
        artBoxPxW = Math.round(fullPrintW * effectiveScale);
        artBoxPxH = Math.round(fullPrintH * effectiveScale);
        // Position by center (x,y) so mockup matches Edit placement modal
        left = Math.round(centerXpx - artBoxPxW / 2);
        top = Math.round(centerYpx - artBoxPxH / 2);
      } else {
        // No printArea: match Edit placement modal exactly — box is scale*50% of image (modal: width/height = scale*50%)
        const modalBase = 0.5;
        artBoxPxW = Math.round(blankWidth * modalBase * effectiveScale);
        artBoxPxH = Math.round(blankHeight * modalBase * effectiveScale);
        left = Math.round(centerXpx - artBoxPxW / 2);
        top = Math.round(centerYpx - artBoxPxH / 2);
      }

      // Max-fit scaling: scale (cropped) design to fit inside print area while keeping aspect ratio (no crop/overflow)
      const designAspect = designWidth / designHeight;
      const boxAspect = artBoxPxW / artBoxPxH;
      let resizedWidth, resizedHeight;
      if (designAspect >= boxAspect) {
        resizedWidth = artBoxPxW;
        resizedHeight = Math.round(artBoxPxW / designAspect);
      } else {
        resizedHeight = artBoxPxH;
        resizedWidth = Math.round(artBoxPxH * designAspect);
      }
      console.log("[onMockJobCreated] Scaled artwork to print area: design", designWidth, "x", designHeight, "→", resizedWidth, "x", resizedHeight, "placement:", placementId, "scale:", effectiveScale, "center:", (x ?? 0.5).toFixed(2), (y ?? 0.5).toFixed(2));

      // Pipeline: resize → optional print-realism (blur/desat) → mask → opacity → multiply
      // Defaults are NO-OP (0 and 1.0) so production matches what the editor preview shows
      // by default. Original defaults (0.3 / 0.96) were tuned for 8394 panty fabric and made
      // HF07 crewneck prints look mushy. Per-blank opt-in via `placement.printBlurSigma` and
      // `placement.printSaturation`. Aligned with composeStageA in blankPreviewRender lib.
      const printBlurSigma = placement.printBlurSigma ?? 0;
      const printSaturation = placement.printSaturation ?? 1.0;
      // kernel: lanczos2 preserves text edges better than the default lanczos3 when designs
      // downsample from natural (e.g. 2400px) to placement size. Aligned with composeStageA.
      let resizePipeline = sharp(designBuffer).resize(resizedWidth, resizedHeight, { fit: "inside", kernel: "lanczos2" });
      if (printBlurSigma > 0) resizePipeline = resizePipeline.blur(printBlurSigma);
      if (printSaturation !== 1.0) resizePipeline = resizePipeline.modulate({ saturation: printSaturation });
      const resizedResult = await resizePipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ depth: 8, resolveWithObject: true });
      let resizedDesignRaw = resizedResult.data;
      const actualW = resizedResult.info.width;
      const actualH = resizedResult.info.height;

      /**
       * v10.3 (2026-05-25): force CLEAN BLEND for Stage A to match the editor preview
       * pipeline (functions/lib/blankPreviewRender.js > composeStageA v8.3).
       *
       * Stage A is no longer the final output — Stage B v10 (Flux Fill hybrid composite)
       * runs on top of it for `quality === "final"` renders. Stage A's job is now to be
       * a CLEAN vivid color reference that anchors the hybrid composite. The old
       * "soft-light + 0.9 opacity" defaults mattered when Stage A WAS the final output
       * (Phase 1 deterministic-only); they don't help Stage B and actively desaturate
       * the colors Flux Fill needs to anchor on inside the mask region.
       *
       * Editor preview forces normal/1.0 always; production now matches so the
       * hybrid composite gets the same color anchor in both pipelines.
       *
       * `placement.blendMode` / `placement.blendOpacity` are intentionally ignored
       * here. The "Print style / blend" sliders predate v10 — they're for the AI
       * prompt now (via fabricFeel/printStrength), not for Stage A appearance.
       */
      const blendModeRequested = "normal";
      const blendMode = "over"; // Sharp's name for "normal" / source-over
      const effectiveOpacity = 1.0;
      console.log(
        `[onMockJobCreated] v10.3 clean Stage A blend: forced normal/1.0 (editor sent ${placement.blendMode || "default"}/${placement.blendOpacity != null ? placement.blendOpacity : "default"}, sliders now drive Stage B prompt only)`
      );

      /**
       * Fabric mask: design × mask for fabric integration. Three gates:
       *   1. `placement.maskConfig.mode === "none"` → skip (operator opted out via Render profile dropdown).
       *      Null/undefined or "blank_mask_doc" → apply if a mask doc exists.
       *   2. Mask doc must exist with a downloadUrl.
       *   3. Mask must not look inverted (mean > 80).
       */
      const maskMode =
        placement && placement.maskConfig && typeof placement.maskConfig.mode === "string"
          ? placement.maskConfig.mode
          : null;
      const maskDocId = `${blankId}_${view}`;
      const maskDoc = maskMode === "none" ? null : await db.collection("rp_blank_masks").doc(maskDocId).get();
      const maskData = maskDoc && maskDoc.exists ? maskDoc.data() : null;
      if (maskMode === "none") {
        console.log("[onMockJobCreated] Skipping fabric mask (maskConfig.mode='none')");
      }
      /**
       * Pre-compute the design's actual top-left on the garment (after fit:inside
       * centering within the art box) so the mask extract aligns with where the
       * design is actually placed. Hoisted above the mask read because the mask
       * extract needs these coords. Re-used below by the composite.
       */
      const designLeft = Math.max(0, Math.min(Math.round(left + (artBoxPxW - actualW) / 2), blankWidth - actualW));
      const designTop = Math.max(0, Math.min(Math.round(top + (artBoxPxH - actualH) / 2), blankHeight - actualH));

      if (maskData?.mask?.downloadUrl) {
        try {
          const maskResp = await fetch(maskData.mask.downloadUrl);
          if (maskResp.ok) {
            /**
             * Mask is in BLANK coords (1500×1500 garment image). Resize to blank dims,
             * then extract the sub-region under the design's placement. The previous
             * stretch-to-design-bbox approach compressed sparse masks (HF07 chest panel
             * silhouette) into a thin band — clipped most of the design. Aligned with
             * composeStageA in functions/lib/blankPreviewRender.js.
             */
            // Single-channel grayscale raw — no ensureAlpha. The stride mismatch
            // (mask 2 bytes/px with ensureAlpha vs design 4 bytes/px) was zeroing the
            // bottom half of the design. Aligned with composeStageA in blankPreviewRender.
            const maskResult = await sharp(await maskResp.arrayBuffer())
              .resize(blankWidth, blankHeight, { fit: "fill" })
              .extract({ left: designLeft, top: designTop, width: actualW, height: actualH })
              .grayscale()
              .raw()
              .toBuffer({ depth: 8, resolveWithObject: true });
            const maskBuffer = maskResult.data;
            const maskNumPixels = maskBuffer.length;
            let maskSum = 0;
            for (let p = 0; p < maskNumPixels; p++) maskSum += maskBuffer[p];
            const maskMean = maskNumPixels > 0 ? maskSum / maskNumPixels : 0;
            // Empty-mask sanity check. The extracted region is the part of the mask under
            // the design's footprint. Mean ~0 → design outside print zone, skip (multiply
            // would zero the design). Mean ~255 → design fully inside print zone, apply as
            // no-op (multiplying by white = identity). Keep aligned with composeStageA in
            // functions/lib/blankPreviewRender.js.
            if (maskMean >= 5) {
              // Walk by pixel index: mask 1 byte/px, design 4 bytes/px.
              for (let p = 0; p < maskNumPixels; p++) {
                const m = maskBuffer[p];
                const i = p * 4;
                resizedDesignRaw[i] = Math.round((resizedDesignRaw[i] * m) / 255);
                resizedDesignRaw[i + 1] = Math.round((resizedDesignRaw[i + 1] * m) / 255);
                resizedDesignRaw[i + 2] = Math.round((resizedDesignRaw[i + 2] * m) / 255);
                resizedDesignRaw[i + 3] = Math.round((resizedDesignRaw[i + 3] * m) / 255);
              }
            } else {
              console.log("[onMockJobCreated] Skipping fabric mask (mean=" + Math.round(maskMean) + ", likely inverted)");
            }
          }
        } catch (maskErr) {
          console.warn("[onMockJobCreated] Fabric mask apply failed:", maskErr.message);
        }
      }
      const designWithOpacity = applyOpacityToRgbaBuffer(resizedDesignRaw, actualW, actualH, effectiveOpacity);
      const designPremultiplied = premultiplyRgbaBuffer(designWithOpacity);
      const designForComposite = await sharp(designPremultiplied, {
        raw: { width: actualW, height: actualH, channels: 4, premultiplied: true },
      })
        .png()
        .toBuffer();

      // Composite at designLeft/designTop computed above the mask read — keeps mask + design aligned.
      const draftBuffer = await sharp(blankBuffer)
        .composite([{
          input: designForComposite,
          left: designLeft,
          top: designTop,
          blend: blendMode,
          premultiplied: true,
        }])
        .png()
        .toBuffer();

      const draftMeta = await sharp(draftBuffer).metadata();

      // Save to Storage
      const timestamp = Date.now();
      const storagePath = `rp/mocks/${designId}/${blankId}/${view}/${timestamp}/draft.png`;
      
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      
      await file.save(draftBuffer, {
        contentType: "image/png",
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      });

      // Make file public and get URL
      await file.makePublic();
      const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

      console.log("[onMockJobCreated] Saved draft to:", storagePath);

      // Create the mock asset document
      const draftAssetData = {
        designId,
        blankId,
        view,
        placementId,
        kind: "draft_composite",
        image: {
          storagePath,
          downloadUrl,
          width: draftMeta.width,
          height: draftMeta.height,
          bytes: draftBuffer.length,
          contentType: "image/png",
        },
        provenance: {
          jobId,
        },
        approved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: job.createdByUid,
      };

      const draftAssetRef = await db.collection("rp_mock_assets").add(draftAssetData);
      console.log("[onMockJobCreated] Created draft asset:", draftAssetRef.id);

      // If job is linked to a product, save mockup to /products/{productId}/mockup.png and set product.mockupUrl
      let mockupBufferForProduct = draftBuffer;
      let mockupDownloadUrlForProduct = downloadUrl;
      if (job.productId) {
        const parentId = job.productId;
        const productVariantId =
          job.productVariantId && typeof job.productVariantId === "string" ? job.productVariantId : null;
        const productRef = db.collection("rp_products").doc(parentId);
        const variantRef = productVariantId ? productRef.collection("variants").doc(productVariantId) : null;
        const pathPrefix = productVariantId
          ? `products/${parentId}/variants/${productVariantId}`
          : `products/${parentId}`;
        const productMockPath = `${pathPrefix}/mockup.png`;
        const productMockFile = bucket.file(productMockPath);
        await productMockFile.save(draftBuffer, {
          contentType: "image/png",
          metadata: { cacheControl: "public, max-age=31536000" },
        });
        await productMockFile.makePublic();
        const productMockUrl = `https://storage.googleapis.com/${bucket.name}/${productMockPath}`;
        const targetRef = variantRef || productRef;
        const currentProduct = (await targetRef.get()).data() || {};
        const prevMedia = currentProduct.media || {};
        // Do not set heroFront/heroBack to undefined — Firestore rejects undefined. Spread copies existing slots only.
        const media = {
          ...prevMedia,
          gallery: Array.isArray(prevMedia.gallery) ? prevMedia.gallery : [],
        };

        let blankVariantIdForAsset = null;
        if (variantRef) {
          blankVariantIdForAsset = currentProduct.blankVariantId || null;
        }

        // Phase 4: If heroSlot is set, create product asset and set product.media.heroFront/heroBack
        if (job.heroSlot === "hero_front" || job.heroSlot === "hero_back") {
          const assetPath = `${pathPrefix}/hero/${job.view}/${Date.now()}.png`;
          const heroFile = bucket.file(assetPath);
          await heroFile.save(draftBuffer, {
            contentType: "image/png",
            metadata: { cacheControl: "public, max-age=31536000" },
          });
          await heroFile.makePublic();
          const heroUrl = `https://storage.googleapis.com/${bucket.name}/${assetPath}`;
          const now = admin.firestore.FieldValue.serverTimestamp();
          const assetData = {
            productId: parentId,
            parentProductId: parentId,
            variantDocId: productVariantId || null,
            blankVariantId: blankVariantIdForAsset,
            jobId,
            designId: job.designId,
            blankId: job.blankId,
            assetType: "productPackshot",
            presetMode: "productOnly",
            status: "approved",
            heroSlot: job.heroSlot,
            storagePath: assetPath,
            publicUrl: heroUrl,
            downloadUrl: heroUrl,
            width: draftMeta.width,
            height: draftMeta.height,
            createdAt: now,
            updatedAt: now,
            createdBy: job.createdByUid,
            updatedBy: job.createdByUid,
          };
          const sanitizedAsset = sanitizeForFirestore(assetData);
          const heroAssetRef = await db.collection("rp_product_assets").add(sanitizedAsset);
          heroAssetId = heroAssetRef.id;
          heroAssetUrl = heroUrl;
          if (job.heroSlot === "hero_front") media.heroFront = heroUrl;
          if (job.heroSlot === "hero_back") media.heroBack = heroUrl;
          console.log("[onMockJobCreated] Created hero asset and set product.media." + (job.heroSlot === "hero_front" ? "heroFront" : "heroBack"));
        } else {
          if (job.view === "back") {
            media.heroBack = productMockUrl;
          } else {
            media.heroFront = productMockUrl;
          }
          const ts = admin.firestore.FieldValue.serverTimestamp();
          const galleryAssetData = {
            productId: parentId,
            parentProductId: parentId,
            variantDocId: productVariantId || null,
            blankVariantId: blankVariantIdForAsset,
            jobId,
            designId: job.designId,
            blankId: job.blankId,
            assetType: "productPackshot",
            presetMode: "productOnly",
            status: "approved",
            storagePath: productMockPath,
            publicUrl: productMockUrl,
            downloadUrl: productMockUrl,
            width: draftMeta.width,
            height: draftMeta.height,
            view: job.view || "back",
            assetRole: "blended",
            createdAt: ts,
            updatedAt: ts,
            createdBy: job.createdByUid,
            updatedBy: job.createdByUid,
          };
          await db.collection("rp_product_assets").add(sanitizeForFirestore(galleryAssetData));
          console.log(
            "[onMockJobCreated] Created rp_product_assets row (blended) for product",
            parentId,
            productVariantId || ""
          );
        }

        await targetRef.update({
          mockupUrl: productMockUrl,
          media,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: job.createdByUid,
        });
        if (variantRef) {
          const parentSnap = await productRef.get();
          const pdata = parentSnap.data() || {};
          const hid = pdata.heroVariantId || pdata.defaultVariantId;
          if (hid && hid === productVariantId) {
            const { heroUrl, thumbUrl } = pickParentDisplayMediaFromVariantMedia(
              media,
              productMockUrl,
              pdata.blankStyleCode
            );
            await productRef.update({
              displayMedia: { heroUrl, thumbUrl },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedBy: job.createdByUid,
            });
          }
        }
        console.log("[onMockJobCreated] Saved product mockup:", productMockPath);
        // Unblock bulk job items waiting for this product's mock (two-layer architecture)
        const awaitingItems = await db.collection("rp_bulk_generation_job_items")
          .where("productId", "==", job.productId)
          .where("status", "==", "awaiting_mock")
          .get();
        const batch = db.batch();
        awaitingItems.docs.forEach(doc => {
          batch.update(doc.ref, {
            status: "pending",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        if (!awaitingItems.empty) {
          await batch.commit();
          console.log("[onMockJobCreated] Unblocked", awaitingItems.size, "bulk job items for product", job.productId);
        }

        if (variantRef && productVariantId && (job.view === "back" || !job.view)) {
          try {
            const parentSnap8394 = await productRef.get();
            const pdata8394 = parentSnap8394.data() || {};
            const bid8394 = pdata8394.blankId;
            if (bid8394) {
              const bs8394 = await db.collection("rp_blanks").doc(String(bid8394)).get();
              if (bs8394.exists && String(bs8394.data().styleCode || "").trim() === "8394") {
                await variant8394Pipeline.run8394FlatAfterVariantMock({
                  admin,
                  db,
                  parentId,
                  productVariantId,
                  jobId,
                  createdByUid: job.createdByUid,
                  sanitizeForFirestore,
                });
              }
            }
          } catch (pipeErr) {
            console.error("[onMockJobCreated] 8394 flat pipeline:", pipeErr && pipeErr.message ? pipeErr.message : pipeErr);
            launchBatchLog("WORKER_FAILURE", {
              batchId: job.productAssetBatchId || null,
              role: "flat_pipeline",
              jobId,
              stage: "run8394FlatAfterVariantMock_outer",
              error:
                pipeErr && pipeErr.message
                  ? String(pipeErr.message)
                  : pipeErr != null
                    ? String(pipeErr)
                    : "unknown",
            });
          }
        }
      }

      // --- Stage B v10 (2026-05-25): Flux Fill inpaint + hybrid composite ---
      // Ported from editor preview pipeline (functions/lib/blankPreviewRender.js).
      // Replaces the old img2img / Phase 1-gated Stage B. The legacy gate
      // `MOCK_PHASE1_DETERMINISTIC_ONLY` is intentionally NOT consulted here — v10 is
      // the new default for `quality === "final"` renders. The const is kept around
      // (line ~7279) for backward compat with any other code that may reference it.
      // To opt out of AI realism for a specific job, the launch caller can set
      // `quality` to anything other than `"final"` (e.g. `"draft"`).
      let finalAssetId = null;
      if (quality === "final") {
        console.log("[onMockJobCreated] Processing Stage B v10: Flux Fill realism pass");

        const FAL_API_KEY = getFalApiKey();
        if (!FAL_API_KEY) {
          console.warn("[onMockJobCreated] FAL_API_KEY not set - shipping Stage A only");
        } else {
          try {
            // Build letter mask from the design alpha buffer (same logic as preview).
            // onMockJobCreated composites at native (no oversample), so OVERSAMPLE=1
            // and designLeft/designTop are already in native blank coordinates.
            const letterMaskBuffer = await buildLetterMaskFromDesignRgba({
              sharp,
              resizedDesignRaw,
              actualW,
              actualH,
              designLeft,
              designTop,
              nativeBlankW: blankWidth,
              nativeBlankH: blankHeight,
              OVERSAMPLE: 1,
            });

            // Resolve design colors for prompt injection — fetch the design doc fresh
            // here since onMockJobCreated doesn't have the design object in scope from
            // earlier (only designId via the job).
            let designColors = [];
            try {
              const designSnapForRealism = await db.collection("designs").doc(designId).get();
              const designForRealism = designSnapForRealism.exists ? designSnapForRealism.data() : null;
              designColors = designForRealism && Array.isArray(designForRealism.colors)
                ? designForRealism.colors
                : [];
            } catch (designErr) {
              console.warn("[onMockJobCreated] Could not load design colors for Stage B:", designErr && designErr.message);
            }

            // Slider values from the resolved placement (createMockJob surfaces these
            // from blank.placements[i].fabricFeel / blank.blendSettings.fabricFeel).
            const fabricFeel = Number.isFinite(Number(placement.fabricFeel)) ? Number(placement.fabricFeel) : 0.5;
            const printStrength = Number.isFinite(Number(placement.printStrength)) ? Number(placement.printStrength) : 0.7;

            // Run v10 realism: Flux Fill inpaint + hybrid composite back onto Stage A.
            const realism = await runRealismPass({
              sharp,
              db,
              fetchFn: fetch,
              falApiKey: FAL_API_KEY,
              blankId,
              view: view || "front",
              draftBuffer,
              draftMeta,
              letterMaskBuffer,
              designColors,
              fabricFeel,
              printStrength,
            });

            const finalBuffer = realism.buffer;
            const finalMeta = await sharp(finalBuffer).metadata();

            // Save final image to Storage at the same `final.png` path the legacy block used.
            const finalStoragePath = `rp/mocks/${designId}/${blankId}/${view}/${timestamp}/final.png`;
            const finalFile = bucket.file(finalStoragePath);
            await finalFile.save(finalBuffer, {
              contentType: "image/png",
              metadata: { cacheControl: "public, max-age=31536000" },
            });
            await finalFile.makePublic();
            const finalDownloadUrl = `https://storage.googleapis.com/${bucket.name}/${finalStoragePath}`;
            console.log("[onMockJobCreated] Saved final v10 realism to:", finalStoragePath, "endpoint:", realism.falEndpoint);

            // Provenance: prompt hash kept for parity with the legacy block (consumers
            // expect provenance.promptHash). v10's prompt is dynamic (per fabricFeel /
            // printStrength bands) so we hash the params + endpoint as a stand-in.
            const promptHashSource = JSON.stringify({
              endpoint: realism.falEndpoint,
              params: realism.params,
              colors: designColors.map((c) => c && c.hex).filter(Boolean),
            });
            const promptHash = crypto.createHash("md5").update(promptHashSource).digest("hex").substring(0, 8);

            const finalAssetData = {
              designId,
              blankId,
              view,
              placementId,
              kind: "final_realistic",
              image: {
                storagePath: finalStoragePath,
                downloadUrl: finalDownloadUrl,
                width: finalMeta.width,
                height: finalMeta.height,
                bytes: finalBuffer.length,
                contentType: "image/png",
              },
              provenance: {
                jobId,
                modelProvider: "fal",
                modelName: realism.falEndpoint,
                params: {
                  ...realism.params,
                  usedMask: realism.useMask === true,
                  pipeline: "stageB_v10_flux_fill_hybrid",
                },
                promptHash,
              },
              approved: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              createdByUid: job.createdByUid,
            };

            const finalAssetRef = await db.collection("rp_mock_assets").add(finalAssetData);
            finalAssetId = finalAssetRef.id;
            console.log("[onMockJobCreated] Created final asset (v10):", finalAssetId);

            // Overwrite product mockup with the realism image when this job is linked to a product.
            // Same pattern the legacy Stage B used — keeps downstream consumers (gallery, displayMedia,
            // bulk-job awaiting_mock unblocking) on the same path regardless of v10 vs legacy.
            if (job.productId) {
              const parentIdFinal = job.productId;
              const vidFinal =
                job.productVariantId && typeof job.productVariantId === "string" ? job.productVariantId : null;
              const pathPrefixFinal = vidFinal
                ? `products/${parentIdFinal}/variants/${vidFinal}`
                : `products/${parentIdFinal}`;
              const productMockPath = `${pathPrefixFinal}/mockup.png`;
              const productMockFile = bucket.file(productMockPath);
              await productMockFile.save(finalBuffer, {
                contentType: "image/png",
                metadata: { cacheControl: "public, max-age=31536000" },
              });
              await productMockFile.makePublic();
              const productMockUrl = `https://storage.googleapis.com/${bucket.name}/${productMockPath}`;
              const productRefFinal = db.collection("rp_products").doc(parentIdFinal);
              const targetRefFinal = vidFinal
                ? productRefFinal.collection("variants").doc(vidFinal)
                : productRefFinal;
              const snapFinal = await targetRefFinal.get();
              const curFinal = snapFinal.data() || {};
              const mediaFinal = { ...(curFinal.media || {}) };
              if (job.view === "back") {
                mediaFinal.heroBack = productMockUrl;
              } else {
                mediaFinal.heroFront = productMockUrl;
              }
              await targetRefFinal.update({
                mockupUrl: productMockUrl,
                media: mediaFinal,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: job.createdByUid,
              });
              if (vidFinal) {
                const pdataF = (await productRefFinal.get()).data() || {};
                const hid = pdataF.heroVariantId || pdataF.defaultVariantId;
                if (hid && hid === vidFinal) {
                  const { heroUrl, thumbUrl } = pickParentDisplayMediaFromVariantMedia(
                    mediaFinal,
                    productMockUrl,
                    pdataF.blankStyleCode
                  );
                  await productRefFinal.update({
                    displayMedia: { heroUrl, thumbUrl },
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedBy: job.createdByUid,
                  });
                }
              }
              try {
                const galSnap = await db.collection("rp_product_assets").where("jobId", "==", jobId).limit(10).get();
                const updTs = admin.firestore.FieldValue.serverTimestamp();
                await Promise.all(
                  galSnap.docs.map((d) =>
                    d.ref.update({
                      downloadUrl: productMockUrl,
                      publicUrl: productMockUrl,
                      storagePath: productMockPath,
                      width: finalMeta.width,
                      height: finalMeta.height,
                      updatedAt: updTs,
                    })
                  )
                );
              } catch (galErr) {
                console.warn("[onMockJobCreated] Could not update gallery asset after final:", galErr && galErr.message);
              }
              console.log("[onMockJobCreated] Updated product mockup with v10 final:", productMockPath);
              // Unblock bulk job items waiting for this product's mock (two-layer architecture)
              const awaitingItemsFinal = await db.collection("rp_bulk_generation_job_items")
                .where("productId", "==", job.productId)
                .where("status", "==", "awaiting_mock")
                .get();
              const batchFinal = db.batch();
              awaitingItemsFinal.docs.forEach(doc => {
                batchFinal.update(doc.ref, {
                  status: "pending",
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              });
              if (!awaitingItemsFinal.empty) {
                await batchFinal.commit();
                console.log("[onMockJobCreated] Unblocked", awaitingItemsFinal.size, "bulk job items (final) for product", job.productId);
              }
            }

          } catch (realismErr) {
            console.error(
              "[onMockJobCreated] v10 Stage B failed, shipping Stage A:",
              realismErr && realismErr.message ? realismErr.message : realismErr
            );
            // Don't fail the whole job - Stage A draft was still created successfully.
          }
        }
      }

      // Update job as succeeded (include hero asset id/url when this was a hero job)
      await jobRef.update({
        status: "succeeded",
        output: {
          draftAssetId: draftAssetRef.id,
          finalAssetId: finalAssetId,
          ...(heroAssetId && { heroAssetId, heroAssetUrl }),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("[onMockJobCreated] Job succeeded:", jobId);

    } catch (err) {
      console.error("[onMockJobCreated] Job failed:", jobId, err);

      launchBatchLog("WORKER_FAILURE", {
        batchId: job.productAssetBatchId || null,
        role: "mock_back",
        jobId,
        stage: "onMockJobCreated",
        error: err.message || String(err),
      });

      await jobRef.update({
        status: "failed",
        error: {
          message: err.message || String(err),
          code: err.code || "UNKNOWN",
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        const pid = job.productId;
        const vid = job.productVariantId && typeof job.productVariantId === "string" ? job.productVariantId : null;
        if (pid && vid) {
          const vref = db.collection("rp_products").doc(pid).collection("variants").doc(vid);
          await vref.update({
            "assetPipeline.mock_back": {
              status: "failed",
              jobId,
              error: err.message || String(err),
              failedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            variant8394NextRetryAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: job.createdByUid || "",
          });
        }
      } catch (annotateErr) {
        console.warn("[onMockJobCreated] variant pipeline annotate failed:", annotateErr && annotateErr.message);
      }
    }
  });

/**
 * Phase D: proactive taxonomy → Shopify smart collections sync. Iterates the
 * active rp_taxonomy_sports/leagues/entities/themes docs and ensures a
 * Shopify smart collection exists for each. Idempotent — safe to call
 * repeatedly. Writes sync state back onto each taxonomy doc.
 *
 * Input:  { collections?: string[], dryRun?: boolean }
 * Output: { summary: Array<{family, code, handle, status, shopifyId?, error?}> }
 */
exports.syncShopifySmartCollectionsFromTaxonomy = functions
  .runWith({ memory: "512MB", timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
    const adminSnap = await db.collection("admins").doc(uid).get();
    if (!adminSnap.exists) {
      throw new functions.https.HttpsError("permission-denied", "Admins only");
    }
    const { collections, dryRun } = data || {};
    const { store, accessToken } = shopifySync.getShopifyConfig();
    return await shopifySmartCollections.syncSmartCollectionsFromTaxonomy({
      db,
      store,
      accessToken,
      collections,
      dryRun: dryRun === true,
      admin,
    });
  });

/**
 * Phase D: read-only status report — which taxonomy entries have synced
 * smart collections vs which are missing. Cheap (Firestore-only, no
 * Shopify call). Drives the catalog page status grid.
 *
 * Input:  { collections?: string[] }
 * Output: { rows: Array<{collection, family, docId, code, expectedHandle, status, shopifyId?, syncedAt?}> }
 */
exports.getShopifySmartCollectionsStatus = functions.https.onCall(async (data, context) => {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign-in required");
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Admins only");
  }
  const { collections } = data || {};
  return await shopifySmartCollections.getShopifySmartCollectionsStatus({ db, collections });
});

/**
 * Shopify catalog sync worker. Processes shopifySyncJobs (entityType: product, action: create_or_update).
 * Loads Rally product, validates readiness, runs productSet (media + single variant + metafields), updates Rally and job.
 */
exports.onShopifySyncJobCreated = functions
  .runWith({ memory: "512MB", timeoutSeconds: 120 })
  .firestore.document("shopifySyncJobs/{jobId}")
  .onCreate(async (snap, ctx) => {
    const jobId = ctx.params.jobId;
    const job = snap.data();
    const jobRef = db.collection("shopifySyncJobs").doc(jobId);

    if (job.entityType !== "product" || job.action !== "create_or_update") {
      await jobRef.update({
        status: "failed",
        error: `Unsupported job: entityType=${job.entityType}, action=${job.action}`,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const entityId = job.entityId;
    if (!entityId) {
      await jobRef.update({
        status: "failed",
        error: "Missing entityId",
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    await jobRef.update({
      status: "running",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const productRef = db.collection("rp_products").doc(entityId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      await jobRef.update({
        status: "failed",
        error: `Product not found: ${entityId}`,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const product = productSnap.data();
    const variantSnap = await productRef.collection("variants").get();
    const variantDocs = variantSnap.docs.map((d) => ({
      id: d.id,
      firestoreDocId: d.id,
      ...d.data(),
    }));
    const readiness = shopifySync.readinessCheck(product, {
      variantDocs,
      printSides: product.fulfillmentSummary?.printSides || null,
    });

    if (!readiness.ready) {
      const errorMsg = `Product not ready for sync: ${readiness.missing.join(", ")}`;
      await productRef.update({
        shopify: {
          ...(product.shopify || {}),
          status: "error",
          lastSyncError: errorMsg,
          lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        launchStatus: LAUNCH_STATUS.FAILED,
        launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...pipelineFailurePatch(admin, errorMsg, PIPELINE_STAGE.SHOPIFY_SYNC),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: product.updatedBy || "",
      });
      await jobRef.update({
        status: "failed",
        error: errorMsg,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.warn("[onShopifySyncJobCreated] Product not ready:", jobId, readiness.missing);
      return;
    }

    try {
      const { store, accessToken } = shopifySync.getShopifyConfig();
      const { productId, variantLinks } = await shopifySync.runProductSync(product, variantDocs, store, accessToken);

      try {
        const colSummary = await shopifySmartCollections.ensureShopifyCollectionsAfterProductSync(
          product,
          store,
          accessToken
        );
        console.log("[onShopifySyncJobCreated] Smart collections ensured:", jobId, JSON.stringify(colSummary));
      } catch (colErr) {
        console.warn(
          "[onShopifySyncJobCreated] Smart collection ensure failed (non-fatal):",
          jobId,
          colErr && colErr.message
        );
      }

      const defaultRallyVid = product.heroVariantId || product.defaultVariantId;
      const defaultLink =
        (defaultRallyVid && variantLinks.find((l) => l.rallyDocId === defaultRallyVid)) || variantLinks[0];
      const primaryShopifyVariantId = defaultLink ? defaultLink.shopifyVariantId : null;

      const nowTs = admin.firestore.FieldValue.serverTimestamp();
      const prevShopifyByVariantId = new Map();
      variantSnap.docs.forEach((d) => {
        const row = d.data();
        prevShopifyByVariantId.set(d.id, row.shopify || {});
      });
      const linksWithDocs = variantLinks.filter((l) => l.rallyDocId);
      const BATCH_MAX = 400;
      for (let i = 0; i < linksWithDocs.length; i += BATCH_MAX) {
        const slice = linksWithDocs.slice(i, i + BATCH_MAX);
        const batch = db.batch();
        for (const link of slice) {
          const vRef = productRef.collection("variants").doc(link.rallyDocId);
          batch.update(vRef, {
            shopify: {
              ...(prevShopifyByVariantId.get(link.rallyDocId) || {}),
              variantId: link.shopifyVariantId,
              status: "synced",
              lastSyncAt: nowTs,
              lastSyncError: null,
            },
            updatedAt: nowTs,
            updatedBy: product.updatedBy || "",
          });
        }
        await batch.commit();
      }

      await productRef.update({
        shopify: {
          ...(product.shopify || {}),
          productId,
          variantId: primaryShopifyVariantId || null,
          status: "synced",
          lastSyncAt: nowTs,
          lastSyncError: null,
        },
        ...pipelineClearErrorPatch(admin),
        launchStatus: LAUNCH_STATUS.LIVE,
        launchUpdatedAt: nowTs,
        updatedAt: nowTs,
        updatedBy: product.updatedBy || "",
      });

      await jobRef.update({
        status: "succeeded",
        responseSummary: `productId=${productId};variants=${variantLinks.length}`,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("[onShopifySyncJobCreated] Sync succeeded:", jobId, productId, "variants", variantLinks.length);
    } catch (err) {
      const message = err.message || String(err);
      console.error("[onShopifySyncJobCreated] Sync failed:", jobId, message);

      await productRef.update({
        shopify: {
          ...(product.shopify || {}),
          status: "error",
          lastSyncError: message,
          lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        launchStatus: LAUNCH_STATUS.FAILED,
        launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...pipelineFailurePatch(admin, message, PIPELINE_STAGE.SHOPIFY_SYNC),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: product.updatedBy || "",
      });

      await jobRef.update({
        status: "failed",
        error: message,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

/**
 * Approve or unapprove a mock asset
 */
exports.approveMockAsset = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { assetId, approved } = data;

  if (!assetId || typeof assetId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "assetId is required");
  }
  if (typeof approved !== "boolean") {
    throw new functions.https.HttpsError("invalid-argument", "approved must be a boolean");
  }

  const assetRef = db.collection("rp_mock_assets").doc(assetId);
  const assetSnap = await assetRef.get();

  if (!assetSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Asset ${assetId} not found`);
  }

  const updateData = {
    approved,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (approved) {
    updateData.approvedAt = admin.firestore.FieldValue.serverTimestamp();
    updateData.approvedByUid = context.auth.uid;
  } else {
    updateData.approvedAt = null;
    updateData.approvedByUid = null;
  }

  await assetRef.update(updateData);

  console.log("[approveMockAsset] Asset", assetId, "approved:", approved);

  return { ok: true };
});

/**
 * Manual retry for 8394 variant base assets (re-queue mock or re-run flat).
 */
exports.retryVariant8394Assets = functions.runWith({ memory: "1GB", timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const productId = data && data.productId;
  const variantId = data && data.variantId;
  if (!productId || typeof productId !== "string" || !variantId || typeof variantId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "productId and variantId are required");
  }
  const result = await variant8394Pipeline.retryVariant8394PipelineCore({
    db,
    admin,
    sanitizeForFirestore,
    parentId: productId,
    variantId,
    userId: context.auth.uid,
  });
  return { ok: true, ...result };
});

/** Auto-retry variants with variant8394NextRetryAt in the past. */
exports.scheduledRetryVariant8394Assets = functions
  .runWith({ memory: "512MB", timeoutSeconds: 300 })
  .pubsub.schedule("every 10 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    let snap;
    try {
      snap = await db.collectionGroup("variants").where("variant8394NextRetryAt", "<=", now).limit(15).get();
    } catch (e) {
      console.warn("[scheduledRetryVariant8394Assets] query failed (index may be deploying):", e.message);
      return null;
    }
    const systemUid = "system_scheduled_retry";
    for (const doc of snap.docs) {
      const pathParts = doc.ref.path.split("/");
      const pid = pathParts[1];
      const vid = pathParts[3];
      if (!pid || !vid || pathParts[0] !== "rp_products" || pathParts[2] !== "variants") continue;
      try {
        await variant8394Pipeline.retryVariant8394PipelineCore({
          db,
          admin,
          sanitizeForFirestore,
          parentId: pid,
          variantId: vid,
          userId: systemUid,
        });
      } catch (err) {
        console.error("[scheduledRetryVariant8394Assets]", pid, vid, err && err.message);
      }
    }
    return null;
  });

const { registerBulkDesignImportHandlers } = require("./lib/bulkDesignImportHandlers");
registerBulkDesignImportHandlers(exports, functions, admin);
