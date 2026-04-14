"use strict";

/**
 * 8394 variant base asset pipeline: back mock (rp_mock_jobs) → flat renders (callable/inline).
 * Progress on variant.assetPipeline; auto-retry via variant8394NextRetryAt + scheduled worker.
 */

const { resolveMockPlacementForProduct } = require("./resolveProductRenderProfile");
const { executeProductFlatRender8394Mvp, pickDesignPngForVariant } = require("./productFlatRenderMvp");
const { getVariantFlatBackUrl } = require("./variantRenderSources");

const RETRY_DELAY_MS = 10 * 60 * 1000;

function mergePlacementSource(parent, variantDoc) {
  if (!variantDoc || typeof variantDoc !== "object") return parent;
  return {
    ...parent,
    renderSetup: variantDoc.renderSetup || parent.renderSetup,
    placementOverrides: variantDoc.placementOverrides != null ? variantDoc.placementOverrides : parent.placementOverrides,
    renderOverrides: variantDoc.renderOverrides != null ? variantDoc.renderOverrides : parent.renderOverrides,
  };
}

function isVariantBaseComplete8394(v) {
  if (!v || typeof v !== "object") return false;
  const blendedUrl =
    v.flatRenders && v.flatRenders.flat_blended && v.flatRenders.flat_blended.back
      ? String(v.flatRenders.flat_blended.back.url || "").trim()
      : "";
  const frontFlatUrl =
    v.flatRenders && v.flatRenders.flat_clean && v.flatRenders.flat_clean.front
      ? String(v.flatRenders.flat_clean.front.url || "").trim()
      : "";
  const heroBack = v.media && v.media.heroBack ? String(v.media.heroBack).trim() : "";
  const heroFront = v.media && v.media.heroFront ? String(v.media.heroFront).trim() : "";
  return !!(blendedUrl && frontFlatUrl && heroBack && heroFront);
}

function nextRetryAt(admin) {
  return admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_DELAY_MS);
}

/**
 * After variant create (8394): enqueue back mock job; `onMockJobCreated` then runs
 * `generateProductFlatRenders` (flat_blended_back + flat_clean_front) on the variant doc — mock → flat for stability.
 */
async function queueVariant8394BaseAssets(ctx) {
  const { db, admin, sanitizeForFirestore, parentId, variantId, userId, productAssetBatchId, productAssetColorKey } = ctx;
  const fetchFn = typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  if (!fetchFn) {
    console.warn("[queueVariant8394BaseAssets] global fetch unavailable; skip auto assets");
    return;
  }

  const productRef = db.collection("rp_products").doc(parentId);
  const variantRef = productRef.collection("variants").doc(variantId);
  const [parentSnap, variantSnap] = await Promise.all([productRef.get(), variantRef.get()]);
  if (!parentSnap.exists || !variantSnap.exists) return;

  const parent = parentSnap.data();
  const variantDoc = variantSnap.data();
  const blankId = parent.blankId;
  if (!blankId) return;

  const bSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!bSnap.exists) return;
  const blank = bSnap.data();
  if (String(blank.styleCode || "").trim() !== "8394") return;

  const blankVariantId = variantDoc.blankVariantId;
  const variantRow = (blank.variants || []).find((v) => v.variantId === blankVariantId);
  if (!variantRow) {
    console.warn("[queueVariant8394BaseAssets] blank variant row missing");
    return;
  }

  const placementProduct = mergePlacementSource(parent, variantDoc);
  const variantBackUrl =
    (variantDoc.renderSetup && variantDoc.renderSetup.back && variantDoc.renderSetup.back.blankImageUrl) ||
    getVariantFlatBackUrl(blank, variantRow);
  if (!variantBackUrl) {
    console.warn("[queueVariant8394BaseAssets] no back image URL");
    await variantRef.update({
      assetPipeline: {
        mock_back: { status: "failed", error: "no_back_image_url", failedAt: admin.firestore.FieldValue.serverTimestamp() },
        flat_render: { status: "blocked", reason: "no_back_image_url" },
      },
      variant8394NextRetryAt: nextRetryAt(admin),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    });
    return;
  }

  const designId =
    (variantDoc.designIdBack && String(variantDoc.designIdBack).trim()) ||
    (parent.designIdBack && String(parent.designIdBack).trim()) ||
    variantDoc.designId ||
    parent.designId;
  if (!designId) return;

  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) return;
  const design = designSnap.data();
  const { url: designPngUrl } = pickDesignPngForVariant(design, variantRow, variantDoc);
  if (!designPngUrl) {
    console.warn("[queueVariant8394BaseAssets] no design PNG for variant");
    await variantRef.update({
      assetPipeline: {
        mock_back: { status: "failed", error: "no_design_png", failedAt: admin.firestore.FieldValue.serverTimestamp() },
        flat_render: { status: "blocked", reason: "no_design_png" },
      },
      variant8394NextRetryAt: nextRetryAt(admin),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    });
    return;
  }

  const placement = resolveMockPlacementForProduct(placementProduct, blank, "back", "back_center", variantRow);

  const jobData = {
    designId,
    blankId,
    view: "back",
    placementId: "back_center",
    quality: "draft",
    productId: parentId,
    productVariantId: variantId,
    heroSlot: null,
    productAssetBatchId: productAssetBatchId || null,
    productAssetColorKey: productAssetColorKey || null,
    input: {
      blankImageUrl: variantBackUrl,
      designPngUrl,
      placement,
    },
    output: {},
    attempts: 0,
    status: "queued",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: userId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const jobRef = await db.collection("rp_mock_jobs").add(sanitizeForFirestore(jobData));

  await variantRef.update({
    assetPipeline: {
      mock_back: {
        status: "queued",
        jobId: jobRef.id,
        enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      flat_render: { status: "pending_mock", message: "Runs after back mock completes" },
    },
    variant8394NextRetryAt: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: userId,
  });
}

/**
 * Called from onMockJobCreated after back mock is saved to the variant (draft path).
 */
async function run8394FlatAfterVariantMock(ctx) {
  const { admin, db, parentId, productVariantId, jobId, createdByUid, sanitizeForFirestore: sanitizeFn } = ctx;
  const sanitizeForFirestore = typeof sanitizeFn === "function" ? sanitizeFn : (x) => x;
  const { on8394FlatPipelineFinishedForBatch } = require("./productAssetBatchHelpers");
  const crypto = require("crypto");
  const fetchFn = typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  if (!fetchFn) {
    throw new Error("fetch unavailable");
  }
  const productRef = db.collection("rp_products").doc(parentId);
  const variantRef = productRef.collection("variants").doc(productVariantId);
  const storage = admin.storage();

  const uid =
    createdByUid && typeof createdByUid === "string" && createdByUid.trim() ? createdByUid.trim() : "system";

  await variantRef.update({
    "assetPipeline.mock_back": {
      status: "succeeded",
      jobId: jobId || null,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    "assetPipeline.flat_render": {
      status: "running",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: uid,
  });

  try {
    await executeProductFlatRender8394Mvp({
      admin,
      db,
      storage,
      fetch: fetchFn,
      crypto,
      data: {
        productId: parentId,
        productVariantId,
      },
      contextUid: uid,
    });

    const vSnap = await variantRef.get();
    const v = vSnap.data() || {};
    const baseComplete = isVariantBaseComplete8394(v);

    await variantRef.update({
      "assetPipeline.flat_render": {
        status: "succeeded",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      "assetPipeline.baseComplete": baseComplete,
      variant8394NextRetryAt: baseComplete ? admin.firestore.FieldValue.delete() : nextRetryAt(admin),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });
    try {
      await on8394FlatPipelineFinishedForBatch({
        db,
        admin,
        sanitizeForFirestore,
        parentId,
        productVariantId,
        succeeded: true,
      });
    } catch (batchErr) {
      console.warn("[run8394FlatAfterVariantMock] batch progress:", batchErr && batchErr.message ? batchErr.message : batchErr);
    }
  } catch (err) {
    const msg =
      err && err.message
        ? String(err.message).slice(0, 480)
        : err && String(err)
          ? String(err).slice(0, 480)
          : "flat_failed";
    await variantRef.update({
      "assetPipeline.flat_render": {
        status: "failed",
        error: msg,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      variant8394NextRetryAt: nextRetryAt(admin),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });
    try {
      await on8394FlatPipelineFinishedForBatch({
        db,
        admin,
        sanitizeForFirestore,
        parentId,
        productVariantId,
        succeeded: false,
        errorMessage: msg,
      });
    } catch (batchErr) {
      console.warn("[run8394FlatAfterVariantMock] batch progress (fail):", batchErr && batchErr.message ? batchErr.message : batchErr);
    }
  }
}

/**
 * Re-run missing/failed steps (manual or scheduled).
 */
async function retryVariant8394PipelineCore(ctx) {
  const { db, admin, sanitizeForFirestore, parentId, variantId, userId } = ctx;
  const fetchFn = typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  if (!fetchFn) {
    throw new Error("fetch unavailable in this environment");
  }

  const productRef = db.collection("rp_products").doc(parentId);
  const variantRef = productRef.collection("variants").doc(variantId);
  const [parentSnap, variantSnap] = await Promise.all([productRef.get(), variantRef.get()]);
  if (!parentSnap.exists || !variantSnap.exists) {
    throw new Error("Product or variant not found");
  }
  const parent = parentSnap.data();
  const variantDoc = variantSnap.data();

  const blankId = parent.blankId;
  if (!blankId) throw new Error("Product has no blankId");
  const bSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!bSnap.exists) throw new Error("Blank not found");
  const blank = bSnap.data();
  if (String(blank.styleCode || "").trim() !== "8394") {
    return { ok: true, skipped: true, reason: "not_8394" };
  }

  if (isVariantBaseComplete8394(variantDoc)) {
    await variantRef.update({
      "assetPipeline.baseComplete": true,
      variant8394NextRetryAt: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    });
    return { ok: true, skipped: true, reason: "already_complete" };
  }

  const mockOk = !!(String(variantDoc.mockupUrl || "").trim() || String(variantDoc.media?.heroBack || "").trim());

  if (!mockOk) {
    const placementProduct = mergePlacementSource(parent, variantDoc);
    const blankVariantId = variantDoc.blankVariantId;
    const variantRow = (blank.variants || []).find((v) => v.variantId === blankVariantId);
    if (!variantRow) throw new Error("Blank variant row missing");
    const variantBackUrl =
      (variantDoc.renderSetup && variantDoc.renderSetup.back && variantDoc.renderSetup.back.blankImageUrl) ||
      getVariantFlatBackUrl(blank, variantRow);
    const designId =
      (variantDoc.designIdBack && String(variantDoc.designIdBack).trim()) ||
      (parent.designIdBack && String(parent.designIdBack).trim()) ||
      variantDoc.designId ||
      parent.designId;
    if (!designId) throw new Error("No design id");
    const designSnap = await db.collection("designs").doc(designId).get();
    if (!designSnap.exists) throw new Error("Design not found");
    const design = designSnap.data();
    const { url: designPngUrl } = pickDesignPngForVariant(design, variantRow, variantDoc);
    if (!designPngUrl || !variantBackUrl) throw new Error("Missing design PNG or back URL");

    const placement = resolveMockPlacementForProduct(placementProduct, blank, "back", "back_center", variantRow);
    const batchId =
      variantDoc.productAssetBatchId && String(variantDoc.productAssetBatchId).trim()
        ? String(variantDoc.productAssetBatchId).trim()
        : null;
    const colorKey =
      variantDoc.productAssetColorKey && String(variantDoc.productAssetColorKey).trim()
        ? String(variantDoc.productAssetColorKey).trim()
        : blankVariantId || null;
    const jobData = {
      designId,
      blankId,
      view: "back",
      placementId: "back_center",
      quality: "draft",
      productId: parentId,
      productVariantId: variantId,
      heroSlot: null,
      productAssetBatchId: batchId,
      productAssetColorKey: colorKey,
      input: {
        blankImageUrl: variantBackUrl,
        designPngUrl,
        placement,
      },
      output: {},
      attempts: 0,
      status: "queued",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const jobRef = await db.collection("rp_mock_jobs").add(sanitizeForFirestore(jobData));
    await variantRef.update({
      assetPipeline: {
        mock_back: {
          status: "queued",
          jobId: jobRef.id,
          enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        flat_render: { status: "pending_mock" },
      },
      variant8394NextRetryAt: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    });
    return { ok: true, requeued: "mock" };
  }

  const crypto = require("crypto");
  const storage = admin.storage();
  await variantRef.update({
    "assetPipeline.flat_render": { status: "running", startedAt: admin.firestore.FieldValue.serverTimestamp() },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: userId,
  });
  try {
    await executeProductFlatRender8394Mvp({
      admin,
      db,
      storage,
      fetch: fetchFn,
      crypto,
      data: {
        productId: parentId,
        productVariantId: variantId,
      },
      contextUid: userId,
    });
    const vSnap = await variantRef.get();
    const v = vSnap.data() || {};
    const baseComplete = isVariantBaseComplete8394(v);
    await variantRef.update({
      "assetPipeline.flat_render": {
        status: "succeeded",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      "assetPipeline.baseComplete": baseComplete,
      variant8394NextRetryAt: baseComplete ? admin.firestore.FieldValue.delete() : nextRetryAt(admin),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    });
    return { ok: true, reran: "flat" };
  } catch (err) {
    const msg = err && err.message ? String(err.message).slice(0, 480) : "flat_failed";
    await variantRef.update({
      "assetPipeline.flat_render": {
        status: "failed",
        error: msg,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      variant8394NextRetryAt: nextRetryAt(admin),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    });
    throw err;
  }
}

module.exports = {
  queueVariant8394BaseAssets,
  run8394FlatAfterVariantMock,
  retryVariant8394PipelineCore,
  isVariantBaseComplete8394,
  nextRetryAt,
};
