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

// Cost estimation for fal.ai generation
// Based on typical pricing: ~$0.01-0.05 per image depending on size and LoRAs
function estimateGenerationCost(imageCount, imageSize, loraCount) {
  const baseCostPerImage = 0.02; // Base cost per image in USD
  const sizeMultiplier = {
    square: 1.0,
    portrait: 1.2,
    landscape: 1.2,
  };
  const loraMultiplier = 1.0 + (loraCount * 0.1); // 10% increase per LoRA
  
  const size = typeof imageSize === "string" ? imageSize : "square";
  const multiplier = (sizeMultiplier[size] || 1.0) * loraMultiplier;
  
  return imageCount * baseCostPerImage * multiplier;
}

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

// Baseline negative prompt to prevent male model drift
const BASELINE_NEGATIVE_PROMPT = "man, male, masculine, beard, mustache, chest hair, broad shoulders, muscular male body, penis, bulge, male underwear, jockstrap, thong for men";

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
 * Create a new product
 */
exports.createProduct = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const {
    name,
    description,
    category,
    baseProductKey,
    colorway,
    supplier,
    ai,
    tags,
    blankId, // Optional: reference to rp_blanks
  } = data || {};

  if (!name || !category || !baseProductKey || !colorway?.name) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "name, category, baseProductKey, and colorway.name are required"
    );
  }

  // If blankId is provided, verify it exists
  if (blankId) {
    const blankRef = db.collection("rp_blanks").doc(blankId);
    const blankSnap = await blankRef.get();
    if (!blankSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Blank not found: ${blankId}`);
    }
  }

  console.log("[createProduct] Creating product:", { name, baseProductKey, blankId });

  // Generate slug
  const slug = generateSlug(name);
  
  // Check if slug already exists
  const existing = await db
    .collection("rp_products")
    .where("slug", "==", slug)
    .get();
  
  if (!existing.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      `Product with slug "${slug}" already exists`
    );
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;

  const productData = {
    slug,
    name,
    description: description || null,
    category,
    baseProductKey,
    colorway: {
      name: colorway.name,
      hex: colorway.hex || null,
    },
    supplier: supplier || null,
    blankId: blankId || null, // Reference to rp_blanks
    ai: {
      productArtifactId: ai?.productArtifactId || null,
      productTrigger: ai?.productTrigger || null,
      productRecommendedScale: ai?.productRecommendedScale || null,
      blankTemplateId: ai?.blankTemplateId || null, // Deprecated: use blankId instead
    },
    status: "draft",
    tags: tags || [],
    counters: {
      assetsTotal: 0,
      assetsApproved: 0,
      assetsPublished: 0,
    },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  // Filter out undefined values
  const sanitized = Object.fromEntries(
    Object.entries(productData).filter(([_, value]) => value !== undefined)
  );

  const productRef = await db.collection("rp_products").add(sanitized);

  console.log("[createProduct] Created product:", productRef.id);

  return {
    ok: true,
    productId: productRef.id,
    slug,
  };
});

/**
 * Create a product from Design + Blank (product-first workflow).
 * Creates minimal rp_products record; mockup is generated via createMockJob with productId.
 */
exports.createProductFromDesignBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { designId, blankId } = data || {};
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }
  if (!blankId || typeof blankId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "blankId is required");
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
  }
  const design = designSnap.data();

  if (!design.files?.png?.downloadUrl) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Design missing PNG preview. Upload a PNG in Design Detail → Files before creating a product."
    );
  }

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) {
    throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
  }
  const blank = blankSnap.data();

  const teamName = design.teamNameCache || design.name || "Design";
  const styleOrColor = blank.colorName || (blank.styleName && blank.styleName.split(/\s+/)[0]) || blank.styleName || "Cotton";
  const name = `${teamName} ${styleOrColor} Panty`;
  let slug = generateSlug(name);
  const existing = await db.collection("rp_products").where("slug", "==", slug).get();
  if (!existing.empty) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userId = context.auth.uid;
  const firstColor = design.colors && design.colors[0];

  const productData = {
    slug,
    name,
    description: null,
    category: "panties",
    baseProductKey: `DESIGN_${designId}_BLANK_${blankId}`,
    colorway: {
      name: firstColor?.name || blank.colorName || "Default",
      hex: firstColor?.hex || blank.colorHex || null,
    },
    blankId,
    designId,
    mockupUrl: null,
    ai: {
      productArtifactId: null,
      productTrigger: null,
      productRecommendedScale: null,
      blankTemplateId: null,
    },
    status: "draft",
    tags: [],
    counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  const productRef = await db.collection("rp_products").add(productData);
  console.log("[createProductFromDesignBlank] Created product:", productRef.id, slug);

  return {
    ok: true,
    productId: productRef.id,
    slug,
  };
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
    if (!design.files?.png?.downloadUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Design ${designId} is missing PNG. Upload a PNG in Design Detail → Files.`
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
 * Find or create a product for designId + blankId (idempotent for bulk).
 */
async function findOrCreateProductForBulk(designId, blankId, userId) {
  const existing = await db.collection("rp_products")
    .where("designId", "==", designId)
    .where("blankId", "==", blankId)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { productId: existing.docs[0].id };
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!designSnap.exists || !blankSnap.exists) {
    throw new Error(`Design or blank not found: ${designId}, ${blankId}`);
  }
  const design = designSnap.data();
  const blank = blankSnap.data();

  const teamName = design.teamNameCache || design.name || "Design";
  const styleOrColor = blank.colorName || (blank.styleName && blank.styleName.split(/\s+/)[0]) || blank.styleName || "Cotton";
  const name = `${teamName} ${styleOrColor} Panty`;
  let slug = generateSlug(name);
  const slugExists = await db.collection("rp_products").where("slug", "==", slug).get();
  if (!slugExists.empty) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const firstColor = design.colors && design.colors[0];
  const productData = {
    slug,
    name,
    description: null,
    category: "panties",
    baseProductKey: `DESIGN_${designId}_BLANK_${blankId}`,
    colorway: {
      name: firstColor?.name || blank.colorName || "Default",
      hex: firstColor?.hex || blank.colorHex || null,
    },
    blankId,
    designId,
    mockupUrl: null,
    ai: { productArtifactId: null, productTrigger: null, productRecommendedScale: null, blankTemplateId: null },
    status: "draft",
    tags: [],
    counters: { assetsTotal: 0, assetsApproved: 0, assetsPublished: 0 },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  const productRef = await db.collection("rp_products").add(productData);
  return { productId: productRef.id };
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
        const hasMockup = !!(product && product.mockupUrl);

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
            const viewImage = blank?.images?.front;
            const placementId = "front_center";
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
              view: "front",
              placementId: "front_center",
              quality: "draft",
              productId,
              input: {
                blankImageUrl: viewImage?.downloadUrl || null,
                designPngUrl: design?.files?.png?.downloadUrl || null,
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

/**
 * Helper: Join positive prompt parts with commas
 */
function joinPos(...parts) {
  return parts
    .filter(Boolean)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .join(", ");
}

/**
 * Helper: Join negative prompt parts with commas
 */
function joinNeg(...parts) {
  return parts
    .filter(Boolean)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .join(", ");
}

/**
 * Helper: Normalize prompt (trim, collapse whitespace, remove duplicate commas)
 */
function normalizePrompt(text) {
  if (!text) return "";
  return text
    .trim()
    .replace(/\s+/g, " ") // collapse whitespace
    .replace(/,\s*,/g, ",") // remove duplicate commas
    .replace(/^,|,$/g, ""); // remove leading/trailing commas
}

/**
 * Helper: Clamp number to 0..1 range and round to 2 decimals
 */
function clamp01(n) {
  if (typeof n !== "number" || isNaN(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

/**
 * Comprehensive prompt resolver with guardrails (Section 3)
 * Implements mode enforcement, underwear strict safety, identity locking
 */
function resolvePromptWithGuardrails(input) {
  const trace = [];
  const loras = [];
  
  const { product, preset, identity, faceArtifact, bodyArtifact, productArtifact, faceScale, bodyScale, productScale, additionalPrompt, additionalNegativePrompt } = input;
  
  let prompt = preset.promptTemplate || "";
  let negative = preset.negativePromptTemplate || "";
  
  // Determine mode (use preset.mode if available, fallback to generationType for backward compatibility)
  const mode = preset.mode || (input.generationType === "product_only" ? "productOnly" : "onModel");
  
  // 1) Apply mode rules (Rule A)
  if (mode === "productOnly") {
    trace.push("preset.mode=productOnly → stripped identity + face/body artifacts");
    // Strip identity/face/body (ignore even if provided)
    // Add product-only constraints
    prompt = joinPos("clean ecommerce packshot, product only", prompt);
    negative = joinNeg(negative, "person, model, mannequin, body, hands, legs, torso, wearing");
  } else {
    // onModel mode
    trace.push("preset.mode=onModel → enforced female subject constraints");
    prompt = joinPos("adult woman, female model", prompt);
    negative = joinNeg(negative, "man, male, boy");
  }
  
  // 2) Identity injection (onModel only, Rule C)
  if (mode === "onModel") {
    if ((preset.requireIdentity !== false) && !identity) {
      throw new Error("Identity required for this preset");
    }
    if (identity) {
      const trigger = identity.token || identity.defaultTriggerPhrase || identity.triggerPhrase || "";
      if (trigger) {
        // Front-load identity trigger (Rule C - identity locking)
        const identityDescriptor = identity.description || "blonde hair, blue-green eyes";
        prompt = joinPos(trigger, identityDescriptor, prompt);
        trace.push("identity trigger front-loaded");
      }
    }
  }
  
  // 3) Underwear strict clamp (Rule B)
  const isUnderwear = ["panties", "underwear", "lingerie"].includes(product.category);
  const strict = preset.safetyProfile === "underwear_strict" || (isUnderwear && mode === "onModel");
  if (strict) {
    prompt = joinPos(prompt, "wearing matching bra or bralette and panties, fully covered, no nudity");
    negative = joinNeg(negative, "nude, topless, nipples, areola, exposed breasts, naked, explicit");
    trace.push("underwear_strict clamp applied (wardrobe + nudity negative)");
  }
  
  // 4) LoRA stacking (Rule D - scale defaults)
  if (mode === "onModel") {
    if ((preset.allowFaceArtifact !== false) && faceArtifact) {
      const weight = clamp01(faceScale ?? preset.defaultFaceScale ?? preset.defaults?.faceScale ?? 0.80);
      if (weight !== null) {
        loras.push({
          artifactId: faceArtifact.id,
          type: "face",
          weight: weight,
          trigger: faceArtifact.trigger || null,
        });
        trace.push(`face artifact added (weight: ${weight})`);
      }
    }
    if ((preset.allowBodyArtifact !== false) && bodyArtifact) {
      const weight = clamp01(bodyScale ?? preset.defaultBodyScale ?? preset.defaults?.bodyScale ?? 0.60);
      if (weight !== null) {
        loras.push({
          artifactId: bodyArtifact.id,
          type: "body",
          weight: weight,
          trigger: bodyArtifact.trigger || null,
        });
        trace.push(`body artifact added (weight: ${weight})`);
      }
    }
  }
  
  // Product LoRA allowed in both modes
  if ((preset.allowProductArtifact !== false) && productArtifact) {
    const weight = clamp01(productScale ?? preset.defaultProductScale ?? preset.defaults?.productScale ?? 0.90);
    if (weight !== null) {
      loras.push({
        artifactId: productArtifact.id,
        type: "product",
        weight: weight,
        trigger: productArtifact.trigger || null,
      });
      trace.push(`product artifact added (weight: ${weight})`);
    }
  }
  
  // 5) Append caller-specified overrides (rare)
  if (additionalPrompt) {
    prompt = joinPos(prompt, additionalPrompt);
    trace.push("additional prompt override applied");
  }
  if (additionalNegativePrompt) {
    negative = joinNeg(negative, additionalNegativePrompt);
    trace.push("additional negative prompt override applied");
  }
  
  // 6) Token replacements
  prompt = prompt
    .replace(/{productName}/g, product.name || "")
    .replace(/{productColorway}/g, product.colorway?.name || "")
    .replace(/{productCategory}/g, product.category || "")
    .replace(/{identityTrigger}/g, identity?.token || identity?.defaultTriggerPhrase || identity?.triggerPhrase || "")
    .replace(/{identityDescriptor}/g, identity?.description || "")
    .replace(/{PRODUCT_TRIGGER}/g, product.ai?.productTrigger || product.baseProductKey || "")
    .replace(/{COLORWAY_NAME}/g, product.colorway?.name || "");
  
  // 7) Cleanup
  prompt = normalizePrompt(prompt);
  negative = normalizePrompt(negative);
  
  return {
    prompt,
    negativePrompt: negative,
    loras,
    trace,
  };
}

/**
 * Legacy wrapper for backward compatibility
 * Maps old generationType-based calls to new mode-based resolver
 */
function resolvePrompt(args) {
  const { generationType, product, scenePreset, identity } = args;
  
  // Convert generationType to mode for backward compatibility
  const mode = generationType === "product_only" ? "productOnly" : "onModel";
  
  // Use new resolver
  return resolvePromptWithGuardrails({
    product,
    preset: scenePreset,
    identity,
    faceArtifact: args.faceArtifact || null,
    bodyArtifact: args.bodyArtifact || null,
    productArtifact: args.productArtifact || null,
    faceScale: args.faceScale,
    bodyScale: args.bodyScale,
    productScale: args.productScale,
    generationType, // pass through for mode detection
  });
}

/**
 * Generate product assets (creates a generation job)
 */
/**
 * Helper: Create a generation job (extracted for reuse in batch operations)
 */
async function createGenerationJob(data, userId) {
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
  } = data || {};

  // Validation
  if (!productId || !presetId) {
    throw new Error("productId and presetId are required");
  }

  // Fetch product
  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    throw new Error("Product not found");
  }
  const product = productSnap.data();

  // Fetch preset
  const presetRef = db.collection("rp_scene_presets").doc(presetId);
  const presetSnap = await presetRef.get();
  if (!presetSnap.exists) {
    throw new Error(`Scene preset not found: ${presetId}`);
  }
  const preset = presetSnap.data();

  // Determine preset mode
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
      console.warn("[createGenerationJob] Could not fetch identity:", err);
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
      console.warn("[createGenerationJob] Could not fetch face artifact:", err);
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
      console.warn("[createGenerationJob] Could not fetch body artifact:", err);
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
      console.warn("[createGenerationJob] Could not fetch product artifact:", err);
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
    generationType,
    additionalPrompt: promptOverrides?.prompt,
    additionalNegativePrompt: promptOverrides?.negativePrompt,
  });

  const { prompt: resolvedPrompt, negativePrompt: resolvedNegativePrompt, loras: resolvedLoras, trace: resolverTrace } = resolved;

  // Combine baseline negative prompt
  const finalNegativePrompt = [
    BASELINE_NEGATIVE_PROMPT,
    resolvedNegativePrompt || ""
  ].filter(Boolean).join(", ");

  // Merge artifact scales
  const finalArtifacts = generationType === "on_model" ? {
    faceArtifactId: artifacts?.faceArtifactId || null,
    faceScale: artifacts?.faceScale ?? preset.defaultFaceScale ?? 0.80,
    bodyArtifactId: artifacts?.bodyArtifactId || null,
    bodyScale: artifacts?.bodyScale ?? preset.defaultBodyScale ?? 0.60,
    productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
    productScale: artifacts?.productScale ?? preset.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.90,
  } : {
    productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
    productScale: artifacts?.productScale ?? preset.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.90,
  };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const finalImageCount = imageCount ?? preset.defaultImageCount ?? 4;
  const loraCount = [artifacts?.faceArtifactId, artifacts?.bodyArtifactId, artifacts?.productArtifactId].filter(Boolean).length;
  const costEstimate = estimateGenerationCost(finalImageCount, imageSize, loraCount);

  // Create generation job (inputImageUrl = product.mockupUrl for LoRA pipeline: mockup → model photos)
  const jobData = {
    productId,
    productSlug: product.slug || null,
    designId: designId || null,
    inputImageUrl: product.mockupUrl || null,
    generationType,
    presetMode,
    presetId,
    identityId: presetMode === "onModel" ? identityId : null,
    faceArtifactId: presetMode === "onModel" ? (artifacts?.faceArtifactId || null) : null,
    bodyArtifactId: presetMode === "onModel" ? (artifacts?.bodyArtifactId || null) : null,
    productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
    faceScale: presetMode === "onModel" ? (artifacts?.faceScale ?? preset.defaultFaceScale ?? 0.80) : null,
    bodyScale: presetMode === "onModel" ? (artifacts?.bodyScale ?? preset.defaultBodyScale ?? 0.60) : null,
    productScale: artifacts?.productScale ?? preset.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.90,
    imageCount: finalImageCount,
    size: imageSize,
    seed: seed || preset.defaultSeed || null,
    resolvedPrompt,
    resolvedNegativePrompt: finalNegativePrompt,
    resolvedLoras,
    resolverTrace,
    prompt: resolvedPrompt,
    negativePrompt: finalNegativePrompt,
    artifacts: finalArtifacts,
    provider: "fal",
    endpoint: "fal-ai/flux-lora",
    params: {
      imageCount: finalImageCount,
      size: imageSize,
      seed: seed || preset.defaultSeed || null,
    },
    costEstimate,
    costCurrency: "USD",
    retryCount: 0,
    maxRetries: 3,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  const sanitized = sanitizeForFirestore(jobData);
  const jobRef = await db.collection("rp_generation_jobs").add(sanitized);
  return { jobId: jobRef.id, costEstimate };
}

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

      // PRODUCT_ONLY: Exact composite path — use mockup as-is (deterministic), no generative model
      // Phase 1: Rally must output the real blank + design + placement, matching Photoshop benchmark.
      if (generationType === "product_only") {
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
  },
  "8390": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "thong",
    styleName: "Thong Panty",
    supplierUrl: "https://losangelesapparel.net/collections/women-intimates-panties/products/8390-thong-panty",
    allowedColors: ["Black", "White", "Midnight Navy", "Blue", "Red", "Heather Grey"],
  },
  "TR3008": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Tri-blend Racerback Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/tr3008-tri-blend-racerback-tank",
    allowedColors: ["Black", "Indigo", "Athletic Grey"],
  },
  "1822GD": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "tank",
    styleName: "Garment Dye Crop Tank",
    supplierUrl: "https://losangelesapparel.net/collections/women-tops-tank-tops/products/1822gd-garment-dye-crop-tank",
    allowedColors: ["Black", "Blue", "White"],
  },
  "HF07": {
    supplier: "Los Angeles Apparel",
    garmentCategory: "crewneck",
    styleName: "Heavy Fleece Crewneck (Garment Dye)",
    supplierUrl: "https://losangelesapparel.net/products/hf07-heavy-fleece-crewneck-sweater-garment-dye",
    allowedColors: ["Black", "Navy", "Off-White"],
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

// Default placements per Section 6.4
function getDefaultPlacements(category) {
  return [
    {
      placementId: "front_center",
      label: "Front Center",
      defaultX: 0.5,
      defaultY: 0.5,
      defaultScale: 0.6,
      safeArea: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
    },
    {
      placementId: "back_center",
      label: "Back Center",
      defaultX: 0.5,
      defaultY: 0.5,
      defaultScale: 0.6,
      safeArea: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
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
 * Create a new Blank (v2 - supports all 5 LA Apparel styles)
 * Per RP_Blanks_Library_Spec_v2.md Section 3.3
 */
exports.createBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token?.email || null;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can create blanks");
  }

  const { styleCode, colorName } = data;

  // Validate style
  if (!styleCode || !STYLE_REGISTRY[styleCode]) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `styleCode must be one of: ${ALL_STYLE_CODES.join(", ")}`
    );
  }

  const styleInfo = STYLE_REGISTRY[styleCode];

  // Validate color is allowed for this style
  if (!colorName || !styleInfo.allowedColors.includes(colorName)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `colorName must be one of: ${styleInfo.allowedColors.join(", ")}`
    );
  }

  // Build slug
  const slug = buildBlankSlug(styleCode, colorName);

  // Check for duplicate by slug
  const existingQuery = await db
    .collection("rp_blanks")
    .where("slug", "==", slug)
    .limit(1)
    .get();

  if (!existingQuery.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      `A blank with slug "${slug}" already exists`
    );
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userRef = { uid: userId, email: userEmail };

  // Build document per Section 3.3 schema
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

  // Update blankId to match doc id
  await blankRef.update({ blankId: blankRef.id });

  console.log("[createBlank] Created blank:", blankRef.id, slug);

  return {
    ok: true,
    blankId: blankRef.id,
    slug,
  };
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

  const { blankId, status, frontImage, backImage, imageMeta, clearFrontImage, clearBackImage } = data;

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

  await blankRef.update(updateData);

  console.log("[updateBlank] Updated blank:", blankId);

  return { ok: true };
});

/**
 * Delete/Archive a Blank
 * Archives instead of deleting if referenced by products
 */
exports.deleteBlank = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token?.email || null;

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

  // Check if any products reference this blank
  const productsQuery = await db
    .collection("rp_products")
    .where("blankId", "==", blankId)
    .limit(1)
    .get();

  if (!productsQuery.empty) {
    // Archive instead of delete
    await blankRef.update({
      status: "archived",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: { uid: userId, email: userEmail },
    });
    
    console.log("[deleteBlank] Archived blank (referenced by products):", blankId);
    return { ok: true, action: "archived", reason: "Referenced by products" };
  }

  // Safe to delete
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

// Sample teams for seeding
const SAMPLE_DESIGN_TEAMS = [
  { id: "sf_giants", name: "SF Giants", league: "MLB", primaryColorHex: "#FD5A1E", tags: ["mlb", "giants", "sf"] },
  { id: "sf_49ers", name: "SF 49ers", league: "NFL", primaryColorHex: "#AA0000", tags: ["nfl", "49ers", "sf"] },
  { id: "la_dodgers", name: "LA Dodgers", league: "MLB", primaryColorHex: "#005A9C", tags: ["mlb", "dodgers", "la"] },
  { id: "la_lakers", name: "LA Lakers", league: "NBA", primaryColorHex: "#552583", tags: ["nba", "lakers", "la"] },
  { id: "ny_yankees", name: "NY Yankees", league: "MLB", primaryColorHex: "#003087", tags: ["mlb", "yankees", "ny"] },
  { id: "chicago_bulls", name: "Chicago Bulls", league: "NBA", primaryColorHex: "#CE1141", tags: ["nba", "bulls", "chicago"] },
];

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
 * Create a new Design
 * Required: name, teamId, colors (at least one hex color)
 */
exports.createDesignAsset = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.auth.uid;

  // Check if user is admin
  const adminSnap = await db.collection("admins").doc(userId).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can create designs");
  }

  const { name, teamId, colors, tags, description } = data;

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "name is required");
  }

  if (!teamId || typeof teamId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "teamId is required");
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

  // Generate slug
  const slugBase = `${teamName}-${name}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${slugBase}-${Date.now().toString(36)}`;

  // Normalize colors
  const normalizedColors = colors.map(c => ({
    hex: c.hex.toUpperCase(),
    name: c.name || null,
    role: c.role || "ink",
    notes: c.notes || null,
  }));

  // Generate search keywords
  const searchKeywords = [
    name.toLowerCase(),
    teamName.toLowerCase(),
    teamId.toLowerCase(),
    ...(tags || []).map(t => t.toLowerCase()),
    ...normalizedColors.map(c => c.name?.toLowerCase()).filter(Boolean),
    ...normalizedColors.map(c => c.hex.toLowerCase()),
  ].filter(Boolean);

  const now = admin.firestore.FieldValue.serverTimestamp();

  const designData = {
    name: name.trim(),
    slug,
    teamId,
    teamNameCache: teamName,
    status: "draft",
    tags: tags || [],
    description: description || null,
    files: {
      svg: null,
      png: null,
      pdf: null,
    },
    colors: normalizedColors,
    colorCount: normalizedColors.length,
    placementDefaults: DEFAULT_DESIGN_PLACEMENTS,
    linkedBlankVariantCount: 0,
    linkedProductCount: 0,
    hasSvg: false,
    hasPng: false,
    hasPdf: false,
    isComplete: false,
    searchKeywords,
    createdAt: now,
    updatedAt: now,
    createdByUid: userId,
    updatedByUid: userId,
  };

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
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can update design files");
  }

  const { designId, kind, storagePath, downloadUrl, fileName, contentType, sizeBytes, widthPx, heightPx, sha256 } = data;

  // Validate required fields
  if (!designId || typeof designId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "designId is required");
  }

  if (!kind || !["png", "pdf", "svg"].includes(kind)) {
    throw new functions.https.HttpsError("invalid-argument", "kind must be 'png', 'pdf', or 'svg'");
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

  const fileData = {
    kind,
    storagePath,
    downloadUrl,
    fileName,
    contentType: contentType || (kind === "png" ? "image/png" : kind === "svg" ? "image/svg+xml" : "application/pdf"),
    sizeBytes: sizeBytes || 0,
    widthPx: kind === "png" ? (widthPx || null) : null,
    heightPx: kind === "png" ? (heightPx || null) : null,
    sha256: sha256 || null,
    uploadedAt: now,
    uploadedByUid: userId,
  };

  const updateData = {
    [`files.${kind}`]: fileData,
    updatedAt: now,
    updatedByUid: userId,
  };

  // Update completion flags
  const currentData = designSnap.data();
  const hasSvg = kind === "svg" ? true : !!currentData.files?.svg;
  const hasPng = kind === "png" ? true : !!currentData.files?.png;
  const hasPdf = kind === "pdf" ? true : !!currentData.files?.pdf;

  updateData.hasSvg = hasSvg;
  updateData.hasPng = hasPng;
  updateData.hasPdf = hasPdf;
  updateData.isComplete = hasPng && hasPdf && currentData.colorCount > 0 && !!currentData.teamId;

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
  if (!adminSnap.exists || adminSnap.data()?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Only admins can update designs");
  }

  const { designId, status, colors, tags, description, name } = data;

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

  // Description update
  if (description !== undefined) {
    updateData.description = description || null;
  }

  // Tags update
  if (tags && Array.isArray(tags)) {
    updateData.tags = tags;
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

    const normalizedColors = colors.map(c => ({
      hex: c.hex.toUpperCase(),
      name: c.name || null,
      role: c.role || "ink",
      notes: c.notes || null,
    }));

    updateData.colors = normalizedColors;
    updateData.colorCount = normalizedColors.length;
  }

  // Regenerate search keywords
  const finalName = updateData.name || currentData.name;
  const finalTags = updateData.tags || currentData.tags || [];
  const finalColors = updateData.colors || currentData.colors || [];
  const teamName = currentData.teamNameCache || currentData.teamId;

  updateData.searchKeywords = [
    finalName.toLowerCase(),
    teamName.toLowerCase(),
    currentData.teamId.toLowerCase(),
    ...finalTags.map(t => t.toLowerCase()),
    ...finalColors.map(c => c.name?.toLowerCase()).filter(Boolean),
    ...finalColors.map(c => c.hex.toLowerCase()),
  ].filter(Boolean);

  // Update completion status
  const hasPng = currentData.hasPng || !!currentData.files?.png;
  const hasPdf = currentData.hasPdf || !!currentData.files?.pdf;
  const colorCount = updateData.colorCount !== undefined ? updateData.colorCount : currentData.colorCount;

  updateData.isComplete = hasPng && hasPdf && colorCount > 0 && !!currentData.teamId && 
    (updateData.status || currentData.status) !== "archived";

  await designRef.update(updateData);

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
 * Create a mock generation job
 * Input: { designId, blankId, view, quality }
 * Returns: { jobId }
 */
exports.createMockJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { designId, blankId, view = "front", placementId: inputPlacementId, quality = "draft", productId, heroSlot, blankImageUrl: inputBlankUrl, designPngUrl: inputDesignUrl, placementOverride: inputPlacementOverride } = data;

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
    if (!design.files?.png?.downloadUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Design must have a PNG file uploaded"
      );
    }
    designPngUrl = design.files.png.downloadUrl;
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
    placement = {
      x: printArea.x ?? blankPlacement.defaultX ?? placement.x,
      y: printArea.y ?? blankPlacement.defaultY ?? placement.y,
      width: printArea.width,
      height: printArea.height,
      scale: blankPlacement.defaultScale ?? placement.scale,
      safeArea: blankPlacement.safeArea ?? placement.safeArea,
      rotationDeg: 0,
      blendMode: blankPlacement.blendMode ?? "multiply",
      blendOpacity: blankPlacement.blendOpacity ?? 0.87,
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

  // Master placement override (product-level "default" placement for all variants)
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
  .runWith({ memory: "1GB", timeoutSeconds: 300 })
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

      // Detect artwork bounds and crop to visible design (resilient to padded PNGs — RALLY_FIX_DESIGN_PNG_PADDING_AND_RENDERER_BOUNDS)
      const designMetaOriginal = await sharp(designBuffer).metadata();
      const originalDesignW = designMetaOriginal.width || 1;
      const originalDesignH = designMetaOriginal.height || 1;
      const { buffer: designBufferCropped, width: designWidth, height: designHeight } = await cropDesignToArtworkBounds(designBuffer);
      designBuffer = designBufferCropped;
      console.log("[onMockJobCreated] Design PNG: original", originalDesignW, "x", originalDesignH, "→ artwork bounds", designWidth, "x", designHeight);

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

      // Pipeline: resize → slight blur (removes sticker look) → desaturate (fabric ink realism) → mask → opacity → multiply
      const printBlurSigma = placement.printBlurSigma ?? 0.3;
      const printSaturation = placement.printSaturation ?? 0.96;
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

      // Per RALLY_PHASE1_DETERMINISTIC_PRODUCT_RENDERER: blend (soft-light for print-on-fabric look) + 80–90% opacity
      const blendMode = placement.blendMode || "soft-light";
      const effectiveOpacity = placement.blendOpacity ?? 0.9;

      // Fabric mask: design × mask for fabric integration. Skip if mask appears inverted (would zero design on garment).
      const maskDocId = `${blankId}_${view}`;
      const maskDoc = await db.collection("rp_blank_masks").doc(maskDocId).get();
      const maskData = maskDoc.exists ? maskDoc.data() : null;
      if (maskData?.mask?.downloadUrl) {
        try {
          const maskResp = await fetch(maskData.mask.downloadUrl);
          if (maskResp.ok) {
            const maskResult = await sharp(await maskResp.arrayBuffer())
              .resize(actualW, actualH, { fit: "fill" })
              .grayscale()
              .ensureAlpha()
              .raw()
              .toBuffer({ depth: 8, resolveWithObject: true });
            const maskBuffer = maskResult.data;
            let maskSum = 0;
            let maskCount = 0;
            for (let i = 0; i < maskBuffer.length; i += 4) {
              maskSum += maskBuffer[i];
              maskCount++;
            }
            const maskMean = maskCount > 0 ? maskSum / maskCount : 0;
            // Only apply mask if it looks like "white = garment" (mean > 80). Inverted masks have low mean and would zero the design.
            if (maskMean > 80) {
              for (let i = 0; i < resizedDesignRaw.length; i += 4) {
                const m = maskBuffer[i];
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

      // Center design inside the art box (design is max-fit inside artBoxPxW x artBoxPxH)
      left = Math.round(left + (artBoxPxW - actualW) / 2);
      top = Math.round(top + (artBoxPxH - actualH) / 2);
      left = Math.max(0, Math.min(left, blankWidth - actualW));
      top = Math.max(0, Math.min(top, blankHeight - actualH));

      const draftBuffer = await sharp(blankBuffer)
        .composite([{
          input: designForComposite,
          left,
          top,
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
        const productMockPath = `products/${job.productId}/mockup.png`;
        const productMockFile = bucket.file(productMockPath);
        await productMockFile.save(draftBuffer, {
          contentType: "image/png",
          metadata: { cacheControl: "public, max-age=31536000" },
        });
        await productMockFile.makePublic();
        const productMockUrl = `https://storage.googleapis.com/${bucket.name}/${productMockPath}`;
        const productRef = db.collection("rp_products").doc(job.productId);
        const currentProduct = (await productRef.get()).data() || {};
        const media = { ...(currentProduct.media || {}), heroFront: currentProduct.media?.heroFront, heroBack: currentProduct.media?.heroBack, gallery: currentProduct.media?.gallery || [] };

        // Phase 4: If heroSlot is set, create product asset and set product.media.heroFront/heroBack
        if (job.heroSlot === "hero_front" || job.heroSlot === "hero_back") {
          const assetPath = `products/${job.productId}/hero/${job.view}/${Date.now()}.png`;
          const heroFile = bucket.file(assetPath);
          await heroFile.save(draftBuffer, {
            contentType: "image/png",
            metadata: { cacheControl: "public, max-age=31536000" },
          });
          await heroFile.makePublic();
          const heroUrl = `https://storage.googleapis.com/${bucket.name}/${assetPath}`;
          const now = admin.firestore.FieldValue.serverTimestamp();
          const assetData = {
            productId: job.productId,
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
          await db.collection("rp_product_assets").add(sanitizedAsset);
          if (job.heroSlot === "hero_front") media.heroFront = heroUrl;
          if (job.heroSlot === "hero_back") media.heroBack = heroUrl;
          console.log("[onMockJobCreated] Created hero asset and set product.media." + (job.heroSlot === "hero_front" ? "heroFront" : "heroBack"));
        }

        await productRef.update({
          mockupUrl: productMockUrl,
          media,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: job.createdByUid,
        });
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
      }

      // --- Stage B: AI realism pass (Phase 2 only; Phase 1 = deterministic only) ---
      let finalAssetId = null;
      if (quality === "final" && !MOCK_PHASE1_DETERMINISTIC_ONLY) {
        console.log("[onMockJobCreated] Processing Stage B: AI realism pass");
        
        const FAL_API_KEY = getFalApiKey();
        if (!FAL_API_KEY) {
          console.warn("[onMockJobCreated] FAL_API_KEY not set - skipping final pass");
        } else {
          try {
            // Prompts per spec
            const REALISM_PROMPT = "Studio product photo of the same garment. The artwork is screen printed directly onto the fabric. Preserve garment shape, seams, and lighting. The print follows fabric texture and wrinkles with subtle ink absorption and shading. Keep the artwork geometry and edges exactly the same. Do not change background.";
            const REALISM_NEGATIVE = "distort logo, change text, redraw artwork, add text, change garment shape, change straps/waistband, change background, add objects, blur";
            
            // Convert draft buffer to base64 data URL
            const draftBase64 = draftBuffer.toString("base64");
            const draftDataUrl = `data:image/png;base64,${draftBase64}`;
            
            // --- Phase 3: Check for mask and use inpaint if available ---
            const maskDocId = `${blankId}_${view}`;
            const maskDoc = await db.collection("rp_blank_masks").doc(maskDocId).get();
            const maskData = maskDoc.exists ? maskDoc.data() : null;
            
            let useMask = false;
            let maskBase64 = null;
            let falEndpoint = "fal-ai/flux/dev/image-to-image";
            
            if (maskData && maskData.mask && maskData.mask.downloadUrl) {
              console.log("[onMockJobCreated] Mask found for", maskDocId, "- using inpaint mode");
              
              try {
                // Fetch the mask image
                const maskResp = await fetch(maskData.mask.downloadUrl);
                if (maskResp.ok) {
                  const maskBuffer = Buffer.from(await maskResp.arrayBuffer());
                  
                  // Resize mask to match draft dimensions if needed
                  const maskMeta = await sharp(maskBuffer).metadata();
                  let processedMaskBuffer = maskBuffer;
                  
                  if (maskMeta.width !== draftMeta.width || maskMeta.height !== draftMeta.height) {
                    console.log("[onMockJobCreated] Resizing mask from", maskMeta.width, "x", maskMeta.height, "to", draftMeta.width, "x", draftMeta.height);
                    processedMaskBuffer = await sharp(maskBuffer)
                      .resize(draftMeta.width, draftMeta.height, { fit: "fill" })
                      .png()
                      .toBuffer();
                  }
                  
                  // Normalize mask to strict black (0) / white (255) via threshold
                  // This ensures no gray pixels or anti-aliased edges confuse the inpainting model
                  console.log("[onMockJobCreated] Normalizing mask to strict black/white");
                  processedMaskBuffer = await sharp(processedMaskBuffer)
                    .grayscale()
                    .threshold(128) // pixels >= 128 become white (255), else black (0)
                    .png()
                    .toBuffer();
                  
                  maskBase64 = processedMaskBuffer.toString("base64");
                  useMask = true;
                  falEndpoint = "fal-ai/flux/dev/inpainting";
                } else {
                  console.warn("[onMockJobCreated] Failed to fetch mask:", maskResp.status, "- falling back to img2img");
                }
              } catch (maskErr) {
                console.warn("[onMockJobCreated] Error processing mask:", maskErr.message, "- falling back to img2img");
              }
            } else {
              console.log("[onMockJobCreated] No mask found for", maskDocId, "- using img2img");
            }
            
            const falUrl = resolveFalUrl(falEndpoint);
            console.log("[onMockJobCreated] Calling fal.ai", useMask ? "inpaint" : "img2img", ":", falUrl);
            
            // Build payload based on mode
            let falPayload;
            if (useMask && maskBase64) {
              // Inpaint mode - mask defines editable region
              // With inpaint, we can use slightly higher strength since we're only editing the masked region
              falPayload = {
                image_url: draftDataUrl,
                mask_url: `data:image/png;base64,${maskBase64}`,
                prompt: REALISM_PROMPT,
                negative_prompt: REALISM_NEGATIVE,
                strength: 0.25, // Slightly higher strength for inpaint (spec recommends 0.20-0.30)
                num_inference_steps: 28,
                guidance_scale: 3.5,
                num_images: 1,
                enable_safety_checker: false,
              };
            } else {
              // img2img mode - global edit
              falPayload = {
                image_url: draftDataUrl,
                prompt: REALISM_PROMPT,
                negative_prompt: REALISM_NEGATIVE,
                strength: 0.20, // Low strength to preserve logo
                num_inference_steps: 28,
                guidance_scale: 3.5,
                num_images: 1,
                enable_safety_checker: false,
              };
            }
            
            const falResponse = await fetch(falUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Key ${FAL_API_KEY}`,
              },
              body: JSON.stringify(falPayload),
            });
            
            if (!falResponse.ok) {
              const errorText = await falResponse.text();
              throw new Error(`fal.ai API error (${falResponse.status}): ${errorText}`);
            }
            
            let falResult = await falResponse.json();
            let falRequestId = falResult.request_id || falResult.id;
            
            // Poll for completion if async
            if (falResult.status === "IN_QUEUE" || falResult.status === "IN_PROGRESS") {
              const statusUrl = falResult.status_url || `${falUrl}/requests/${falRequestId}/status`;
              const maxAttempts = 60; // 5 minutes max
              let attempts = 0;
              let completed = false;
              
              while (!completed && attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                attempts++;
                
                const statusResponse = await fetch(statusUrl, {
                  headers: { Authorization: `Key ${FAL_API_KEY}` },
                });
                
                if (statusResponse.ok) {
                  const statusData = await statusResponse.json();
                  if (statusData.status === "COMPLETED" || statusData.images) {
                    falResult = statusData;
                    completed = true;
                  } else if (statusData.status === "FAILED") {
                    throw new Error(`fal.ai job failed: ${statusData.error || "Unknown error"}`);
                  }
                }
              }
              
              if (!completed) {
                throw new Error("fal.ai job timed out");
              }
            }
            
            // Get the result image
            const resultImages = falResult.images || falResult.output?.images || [];
            if (resultImages.length === 0) {
              throw new Error("No images returned from fal.ai");
            }
            
            const resultImageUrl = resultImages[0].url || resultImages[0];
            console.log("[onMockJobCreated] fal.ai returned image:", resultImageUrl);
            
            // Download the final image
            const finalImageResp = await fetch(resultImageUrl);
            if (!finalImageResp.ok) {
              throw new Error(`Failed to download fal.ai result: ${finalImageResp.status}`);
            }
            const finalBuffer = Buffer.from(await finalImageResp.arrayBuffer());
            const finalMeta = await sharp(finalBuffer).metadata();
            
            // Save final image to Storage
            const finalStoragePath = `rp/mocks/${designId}/${blankId}/${view}/${timestamp}/final.png`;
            const finalFile = bucket.file(finalStoragePath);
            
            await finalFile.save(finalBuffer, {
              contentType: "image/png",
              metadata: {
                cacheControl: "public, max-age=31536000",
              },
            });
            
            await finalFile.makePublic();
            const finalDownloadUrl = `https://storage.googleapis.com/${bucket.name}/${finalStoragePath}`;
            
            console.log("[onMockJobCreated] Saved final to:", finalStoragePath);
            
            // Create prompt hash for provenance
            const promptHash = crypto.createHash("md5").update(REALISM_PROMPT).digest("hex").substring(0, 8);
            
            // Create the final mock asset document
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
                modelName: falEndpoint,
                params: {
                  strength: useMask ? 0.25 : 0.20,
                  num_inference_steps: 28,
                  guidance_scale: 3.5,
                  usedMask: useMask,
                  maskDocId: useMask ? maskDocId : null,
                },
                promptHash,
              },
              approved: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              createdByUid: job.createdByUid,
            };
            
            const finalAssetRef = await db.collection("rp_mock_assets").add(finalAssetData);
            finalAssetId = finalAssetRef.id;
            console.log("[onMockJobCreated] Created final asset:", finalAssetId, useMask ? "(with mask/inpaint)" : "(img2img)");

            // Overwrite product mockup with final image when job is linked to a product
            if (job.productId) {
              const productMockPath = `products/${job.productId}/mockup.png`;
              const productMockFile = bucket.file(productMockPath);
              await productMockFile.save(finalBuffer, {
                contentType: "image/png",
                metadata: { cacheControl: "public, max-age=31536000" },
              });
              await productMockFile.makePublic();
              const productMockUrl = `https://storage.googleapis.com/${bucket.name}/${productMockPath}`;
              await db.collection("rp_products").doc(job.productId).update({
                mockupUrl: productMockUrl,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: job.createdByUid,
              });
              console.log("[onMockJobCreated] Updated product mockup with final:", productMockPath);
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

          } catch (falError) {
            console.error("[onMockJobCreated] Stage B failed:", falError.message);
            // Don't fail the whole job - draft was still created successfully
            // Just log the error and continue
          }
        }
      }

      // Update job as succeeded
      await jobRef.update({
        status: "succeeded",
        output: {
          draftAssetId: draftAssetRef.id,
          finalAssetId: finalAssetId,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("[onMockJobCreated] Job succeeded:", jobId);

    } catch (err) {
      console.error("[onMockJobCreated] Job failed:", jobId, err);

      await jobRef.update({
        status: "failed",
        error: {
          message: err.message || String(err),
          code: err.code || "UNKNOWN",
        },
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
