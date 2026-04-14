"use strict";

const { DEFAULT_ASSET_PLAN } = require("./defaultAssetPlan");
const { launchBatchLog, markOfficialAssetRoleTerminal } = require("./productAssetBatchHelpers");
const { logOfficialAssetEnqueue, logOfficialAssetJobResult } = require("./officialAssetPipelineLog");

/** Short prompt hints appended per official catalog role (on-model fal job). */
const OFFICIAL_ROLE_PROMPT_HINT = {
  model_back_designed: "full body back view, studio lighting, wearing the garment, ecommerce catalog",
  model_front_clean: "full body front view, studio lighting, wearing the garment, ecommerce catalog",
  flat_front_clean: "flat lay front garment presentation, clean studio, product-focused",
  flat_back_designed: "flat lay back garment presentation, clean studio, product-focused, print visible",
};

function resolveOfficialScenePresetId(product) {
  const fromProduct = product && product.officialScenePresetId && String(product.officialScenePresetId).trim();
  if (fromProduct) return fromProduct;
  try {
    const e = process.env.OFFICIAL_PRODUCT_SCENE_PRESET_ID;
    if (e && String(e).trim()) return String(e).trim();
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Map official batch role → variant `generatedRenderOutputs` + `flatRenders` / `media`.
 */
function buildVariantPatchForOfficialRole(admin, variantDoc, role, imageUrl, storagePath) {
  const url = String(imageUrl || "").trim();
  if (!url) return null;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const createdAt = admin.firestore.Timestamp.now();

  const v = variantDoc || {};
  const prevGen = Array.isArray(v.generatedRenderOutputs) ? v.generatedRenderOutputs : [];
  const genMap = {
    model_back_designed: { role: "model_back", lookType: "model_blended", sort: 10, view: "back" },
    flat_front_clean: { role: "flat_front", lookType: "flat_clean", sort: 20, view: "front" },
    flat_back_designed: { role: "flat_back", lookType: "flat_blended", sort: 30, view: "back" },
    model_front_clean: { role: "model_front", lookType: "model_clean", sort: 40, view: "front" },
  };
  const g = genMap[role];
  const genEntry = g
    ? {
        role: g.role,
        sourceType: "official_generation",
        sourceImageRole: role,
        url,
        storagePath: storagePath != null ? storagePath : null,
        sort: g.sort,
        createdAt,
        lookType: g.lookType,
        view: g.view,
      }
    : null;

  const nextGen = genEntry
    ? [...prevGen.filter((x) => x && String(x.sourceImageRole || "") !== role), genEntry].sort(
        (a, b) => (a.sort || 0) - (b.sort || 0)
      )
    : prevGen;

  const flatRenders = { ...(v.flatRenders || {}) };
  const slot = {
    url,
    storagePath: storagePath != null ? storagePath : null,
    generatedAt: now,
    lookType: g?.lookType || null,
    view: g?.view || null,
  };

  if (role === "model_back_designed") {
    flatRenders.model_blended = { ...(flatRenders.model_blended || {}), back: { ...slot, lookType: "model_blended", view: "back" } };
  } else if (role === "model_front_clean") {
    flatRenders.model_clean = { ...(flatRenders.model_clean || {}), front: { ...slot, lookType: "model_clean", view: "front" } };
  } else if (role === "flat_front_clean") {
    flatRenders.flat_clean = { ...(flatRenders.flat_clean || {}), front: { ...slot, lookType: "flat_clean", view: "front" } };
  } else if (role === "flat_back_designed") {
    flatRenders.flat_blended = { ...(flatRenders.flat_blended || {}), back: { ...slot, lookType: "flat_blended", view: "back" } };
  }

  const media = { ...(v.media || {}) };
  if (role === "model_back_designed" || role === "flat_back_designed") {
    media.heroBack = url;
  }
  if (role === "model_front_clean" || role === "flat_front_clean") {
    media.heroFront = url;
  }

  return {
    flatRenders,
    media,
    generatedRenderOutputs: nextGen,
    mockupUrl: url,
  };
}

/**
 * @param {object} ctx
 * @param {import("./createGenerationJobCore").createCreateGenerationJob} ctx.createGenerationJob
 */
async function enqueueOfficialProductImages(ctx) {
  const {
    db,
    admin,
    sanitizeForFirestore,
    createGenerationJob,
    productId,
    userId,
    batchId,
    primaries,
    product,
    designId,
    resolvedModelIdentityId,
  } = ctx;

  if (typeof createGenerationJob !== "function") {
    throw new Error("createGenerationJob is required for official product images");
  }

  const presetId = resolveOfficialScenePresetId(product);
  if (!presetId) {
    throw new Error(
      "Official scene preset not configured: set product.officialScenePresetId or OFFICIAL_PRODUCT_SCENE_PRESET_ID"
    );
  }

  const ai = product.ai || {};
  const artifacts = {
    faceArtifactId: ai.faceArtifactId || null,
    bodyArtifactId: ai.bodyArtifactId || null,
    productArtifactId: ai.productArtifactId || null,
    faceScale: ai.faceScale,
    bodyScale: ai.bodyScale,
    productScale: ai.productScale,
  };

  if (!resolvedModelIdentityId) {
    throw new Error("Model identity is required for official on-model generation");
  }

  const loraCount = [artifacts.faceArtifactId, artifacts.bodyArtifactId, artifacts.productArtifactId].filter(Boolean)
    .length;

  for (const { blankVariantId, primaryVariantId } of primaries) {
    for (const role of DEFAULT_ASSET_PLAN) {
      const hint = OFFICIAL_ROLE_PROMPT_HINT[role] || "";
      const { jobId } = await createGenerationJob(
        {
          productId,
          designId: designId || null,
          generationType: "on_model",
          identityId: resolvedModelIdentityId,
          presetId,
          artifacts,
          promptOverrides: hint ? { prompt: hint } : undefined,
          imageCount: 1,
          imageSize: "square",
          initialAssetRole: role,
          productAssetBatchId: batchId,
          productAssetColorKey: blankVariantId,
          productVariantId: primaryVariantId,
        },
        userId
      );

      logOfficialAssetEnqueue({
        productId,
        batchId,
        blankVariantId,
        role,
        generationJobId: jobId,
        presetId,
        identityId: resolvedModelIdentityId,
        loraCount,
      });
    }
  }
}

/**
 * Firestore trigger: `rp_generation_jobs` terminal state for `initialAssetRole` jobs.
 */
async function handleOfficialGenerationJobTerminal({ db, admin, sanitizeForFirestore, before, after, jobId }) {
  if (!after.initialAssetRole || !after.productAssetBatchId || !after.productAssetColorKey) return;
  if (before.status === after.status) return;

  const terminal = after.status === "succeeded" || after.status === "failed";
  if (!terminal) return;

  const productId = after.productId;
  const batchId = String(after.productAssetBatchId).trim();
  const colorKey = String(after.productAssetColorKey).trim();
  const role = String(after.initialAssetRole).trim();
  const variantId = after.productVariantId && String(after.productVariantId).trim() ? String(after.productVariantId).trim() : null;

  if (!productId || !batchId || !colorKey || !DEFAULT_ASSET_PLAN.includes(role)) return;

  if (after.status === "failed") {
    const err =
      (after.lastError && after.lastError.message) || after.errorMessage || "official_generation_failed";
    logOfficialAssetJobResult({
      productId,
      batchId,
      generationJobId: jobId,
      role,
      status: "failed",
      outputCount: 0,
      error: String(err).slice(0, 500),
    });
    await markOfficialAssetRoleTerminal({
      db,
      admin,
      sanitizeForFirestore,
      productId,
      batchId,
      colorKey,
      role,
      ok: false,
      errorMessage: String(err).slice(0, 500),
      jobId,
    });
    return;
  }

  const imgs = after.outputs && Array.isArray(after.outputs.images) ? after.outputs.images : [];
  const first = imgs[0] || null;
  const imageUrl = first && first.downloadUrl ? first.downloadUrl : first && first.url ? first.url : null;
  const storagePath = first && first.storagePath ? first.storagePath : null;

  if (!variantId || !imageUrl) {
    logOfficialAssetJobResult({
      productId,
      batchId,
      generationJobId: jobId,
      role,
      status: "failed",
      outputCount: imgs.length,
      error: "missing_variant_or_image_url",
    });
    await markOfficialAssetRoleTerminal({
      db,
      admin,
      sanitizeForFirestore,
      productId,
      batchId,
      colorKey,
      role,
      ok: false,
      errorMessage: "missing_variant_or_image_url",
      jobId,
    });
    return;
  }

  const variantRef = db.collection("rp_products").doc(productId).collection("variants").doc(variantId);
  const vSnap = await variantRef.get();
  const variantDoc = vSnap.exists ? vSnap.data() || {} : {};
  const patch = buildVariantPatchForOfficialRole(admin, variantDoc, role, imageUrl, storagePath);
  if (patch) {
    await variantRef.set(
      sanitizeForFirestore({
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: after.createdBy || "system",
      }),
      { merge: true }
    );
  }

  logOfficialAssetJobResult({
    productId,
    batchId,
    generationJobId: jobId,
    role,
    status: "succeeded",
    outputCount: imgs.length,
    error: null,
  });

  await markOfficialAssetRoleTerminal({
    db,
    admin,
    sanitizeForFirestore,
    productId,
    batchId,
    colorKey,
    role,
    ok: true,
    errorMessage: null,
    jobId,
  });
}

module.exports = {
  enqueueOfficialProductImages,
  handleOfficialGenerationJobTerminal,
  resolveOfficialScenePresetId,
  OFFICIAL_ROLE_PROMPT_HINT,
};
