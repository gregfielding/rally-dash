"use strict";

const { resolvePromptWithGuardrails } = require("./promptGuardrailsShared");

const BASELINE_NEGATIVE_PROMPT =
  "man, male, masculine, beard, mustache, chest hair, broad shoulders, muscular male body, penis, bulge, male underwear, jockstrap, thong for men";

function estimateGenerationCost(imageCount, imageSize, loraCount) {
  const baseCostPerImage = 0.02;
  const sizeMultiplier = {
    square: 1.0,
    portrait: 1.2,
    landscape: 1.2,
  };
  const loraMultiplier = 1.0 + loraCount * 0.1;
  const size = typeof imageSize === "string" ? imageSize : "square";
  const multiplier = (sizeMultiplier[size] || 1.0) * loraMultiplier;
  return imageCount * baseCostPerImage * multiplier;
}

/**
 * @param {{ db: FirebaseFirestore.Firestore; admin: typeof import("firebase-admin"); sanitizeForFirestore: (x: unknown) => unknown }} deps
 */
function createCreateGenerationJob(deps) {
  const { db, admin, sanitizeForFirestore } = deps;

  return async function createGenerationJob(data, userId) {
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
      initialAssetRole,
      productAssetBatchId,
      productAssetColorKey,
      productVariantId,
    } = data || {};

    if (!productId || !presetId) {
      throw new Error("productId and presetId are required");
    }

    const productRef = db.collection("rp_products").doc(productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      throw new Error("Product not found");
    }
    const product = productSnap.data();

    const presetRef = db.collection("rp_scene_presets").doc(presetId);
    const presetSnap = await presetRef.get();
    if (!presetSnap.exists) {
      throw new Error(`Scene preset not found: ${presetId}`);
    }
    const preset = presetSnap.data();

    const presetMode = preset.mode || (generationType === "product_only" ? "productOnly" : "onModel");

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
        const paRef = db.collection("rp_lora_artifacts").doc(productArtifactId);
        const productSnapA = await paRef.get();
        if (productSnapA.exists) {
          productArtifact = { id: productSnapA.id, ...productSnapA.data() };
        }
      } catch (err) {
        console.warn("[createGenerationJob] Could not fetch product artifact:", err);
      }
    }

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

    const { prompt: resolvedPrompt, negativePrompt: resolvedNegativePrompt, loras: resolvedLoras, trace: resolverTrace } =
      resolved;

    const finalNegativePrompt = [BASELINE_NEGATIVE_PROMPT, resolvedNegativePrompt || ""].filter(Boolean).join(", ");

    const finalArtifacts =
      generationType === "on_model"
        ? {
            faceArtifactId: artifacts?.faceArtifactId || null,
            faceScale: artifacts?.faceScale ?? preset.defaultFaceScale ?? 0.8,
            bodyArtifactId: artifacts?.bodyArtifactId || null,
            bodyScale: artifacts?.bodyScale ?? preset.defaultBodyScale ?? 0.6,
            productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
            productScale: artifacts?.productScale ?? preset.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.9,
          }
        : {
            productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
            productScale: artifacts?.productScale ?? preset.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.9,
          };

    const now = admin.firestore.FieldValue.serverTimestamp();
    const finalImageCount = imageCount ?? preset.defaultImageCount ?? 4;
    const loraCount = [artifacts?.faceArtifactId, artifacts?.bodyArtifactId, artifacts?.productArtifactId].filter(Boolean).length;
    const costEstimate = estimateGenerationCost(finalImageCount, imageSize, loraCount);

    const jobData = {
      productId,
      productSlug: product.slug || null,
      designId: designId || null,
      inputImageUrl: product.mockupUrl || null,
      generationType,
      presetMode,
      presetId,
      identityId: presetMode === "onModel" ? identityId : null,
      faceArtifactId: presetMode === "onModel" ? artifacts?.faceArtifactId || null : null,
      bodyArtifactId: presetMode === "onModel" ? artifacts?.bodyArtifactId || null : null,
      productArtifactId: artifacts?.productArtifactId || product.ai?.productArtifactId || null,
      faceScale: presetMode === "onModel" ? artifacts?.faceScale ?? preset.defaultFaceScale ?? 0.8 : null,
      bodyScale: presetMode === "onModel" ? artifacts?.bodyScale ?? preset.defaultBodyScale ?? 0.6 : null,
      productScale: artifacts?.productScale ?? preset.defaultProductScale ?? product.ai?.productRecommendedScale ?? 0.9,
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
      ...(initialAssetRole ? { initialAssetRole } : {}),
      ...(productAssetBatchId ? { productAssetBatchId } : {}),
      ...(productAssetColorKey ? { productAssetColorKey } : {}),
      ...(productVariantId ? { productVariantId } : {}),
    };

    const sanitized = sanitizeForFirestore(jobData);
    const jobRef = await db.collection("rp_generation_jobs").add(sanitized);
    return { jobId: jobRef.id, costEstimate };
  };
}

module.exports = {
  createCreateGenerationJob,
  estimateGenerationCost,
  BASELINE_NEGATIVE_PROMPT,
};
