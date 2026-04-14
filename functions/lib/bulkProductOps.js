"use strict";

const { LAUNCH_STATUS } = require("./productLaunchStatus");
const { startInitialProductAssetBatch } = require("./startInitialProductAssetBatch");
const { PIPELINE_STAGE, pipelineClearErrorPatch } = require("./pipelineReporting");
const { launchBatchLog } = require("./productAssetBatchHelpers");

/**
 * @param {object} ctx
 * @param {string[]} ctx.productIds
 * @param {'approve'|'hold'} ctx.action
 */
async function bulkMarkProductsReviewed(ctx) {
  const { db, admin, sanitizeForFirestore, productIds, action, userId } = ctx;
  const results = [];
  for (const productId of productIds) {
    const ref = db.collection("rp_products").doc(productId);
    const snap = await ref.get();
    if (!snap.exists) {
      results.push({ productId, ok: false, reason: "not_found" });
      continue;
    }
    const p = snap.data() || {};
    if (action === "approve") {
      const st = p.launchStatus;
      const canApprove =
        st === LAUNCH_STATUS.NEEDS_REVIEW ||
        (st === LAUNCH_STATUS.ASSEMBLING_METADATA && p.shopifyReady === true);
      if (!canApprove) {
        results.push({ productId, ok: false, reason: "wrong_launch_status", launchStatus: st || null });
        continue;
      }
      if (!p.shopifyReady) {
        results.push({ productId, ok: false, reason: "not_shopify_ready" });
        continue;
      }
      await ref.set(
        sanitizeForFirestore({
          launchStatus: LAUNCH_STATUS.SHOPIFY_READY,
          opsReviewStatus: "approved",
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: userId,
          launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: userId,
          ...pipelineClearErrorPatch(admin),
        }),
        { merge: true }
      );
      results.push({ productId, ok: true });
    } else if (action === "hold") {
      await ref.set(
        sanitizeForFirestore({
          opsReviewStatus: "hold",
          launchNote: "operator_hold",
          launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: userId,
        }),
        { merge: true }
      );
      results.push({ productId, ok: true });
    } else {
      results.push({ productId, ok: false, reason: "bad_action" });
    }
  }
  return { ok: true, results };
}

/**
 * Enqueue Shopify sync jobs for approved, ready products.
 */
async function bulkSyncProductsToShopify(ctx) {
  const { db, admin, sanitizeForFirestore, productIds, userId } = ctx;
  const jobIds = [];
  const results = [];
  for (const productId of productIds) {
    const ref = db.collection("rp_products").doc(productId);
    const snap = await ref.get();
    if (!snap.exists) {
      results.push({ productId, ok: false, reason: "not_found" });
      continue;
    }
    const p = snap.data() || {};
    if (p.launchStatus !== LAUNCH_STATUS.SHOPIFY_READY || !p.shopifyReady) {
      results.push({
        productId,
        ok: false,
        reason: "not_ready_for_sync",
        launchStatus: p.launchStatus || null,
      });
      continue;
    }
    const jobRef = await db.collection("shopifySyncJobs").add(
      sanitizeForFirestore({
        entityType: "product",
        entityId: productId,
        action: "create_or_update",
        status: "queued",
        source: "bulk_ops",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: userId || "system",
      })
    );
    jobIds.push(jobRef.id);
    await ref.set(
      sanitizeForFirestore({
        launchStatus: LAUNCH_STATUS.SYNCING_SHOPIFY,
        launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId,
        lastPipelineStage: PIPELINE_STAGE.SHOPIFY_SYNC,
        lastPipelineAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPipelineError: admin.firestore.FieldValue.delete(),
      }),
      { merge: true }
    );
    results.push({ productId, ok: true, jobId: jobRef.id });
  }
  return { ok: true, jobIds, results };
}

/**
 * Retry initial asset batch (8394) for selected parents — best-effort.
 */
async function bulkRetryProductAssets(ctx) {
  const {
    db,
    admin,
    sanitizeForFirestore,
    deriveSizesForProductMatrix,
    productIds,
    userId,
  } = ctx;
  const results = [];
  for (const productId of productIds) {
    try {
      const ref = db.collection("rp_products").doc(productId);
      const priorSnap = await ref.get();
      const priorBatchId =
        priorSnap.exists && priorSnap.data().assetsBatchId && String(priorSnap.data().assetsBatchId).trim()
          ? String(priorSnap.data().assetsBatchId).trim()
          : null;

      await ref.set(sanitizeForFirestore(pipelineClearErrorPatch(admin)), { merge: true });
      const out = await startInitialProductAssetBatch({
        db,
        admin,
        sanitizeForFirestore,
        deriveSizesForProductMatrix,
        productId,
        userId,
        force: true,
        launchOptions: { autoSyncShopify: false },
      });
      launchBatchLog("RETRY_START", {
        productId,
        priorBatchId,
        newBatchId: out && out.assetsBatchId ? String(out.assetsBatchId) : null,
        forced: true,
      });
      results.push({ productId, ok: out && out.ok !== false, detail: out });
    } catch (e) {
      results.push({
        productId,
        ok: false,
        error: e && e.message ? String(e.message) : String(e),
      });
    }
  }
  return { ok: true, results };
}

module.exports = {
  bulkMarkProductsReviewed,
  bulkSyncProductsToShopify,
  bulkRetryProductAssets,
};
