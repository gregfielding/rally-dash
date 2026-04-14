"use strict";

const shopifySync = require("../shopifySync");
const { DEFAULT_ASSET_PLAN } = require("./defaultAssetPlan");
const { buildFulfillmentPackage } = require("./buildFulfillmentPackage");
const {
  PIPELINE_STAGE,
  pipelineFailurePatch,
  pipelineClearErrorPatch,
} = require("./pipelineReporting");

/** Operator-facing pipeline (parent `rp_products`). */
const LAUNCH_STATUS = {
  DRAFT: "draft",
  MATERIALIZING: "materializing",
  GENERATING_ASSETS: "generating_assets",
  ASSEMBLING_METADATA: "assembling_metadata",
  NEEDS_REVIEW: "needs_review",
  SHOPIFY_READY: "shopify_ready",
  SYNCING_SHOPIFY: "syncing_shopify",
  LIVE: "live",
  FAILED: "failed",
};

function skipReviewGate() {
  try {
    return String(process.env.LAUNCH_SKIP_REVIEW_GATE || "").toLowerCase() === "true";
  } catch (e) {
    return false;
  }
}

function launchBatchLog(tag, payload) {
  try {
    console.log(`[LAUNCH_BATCH:${tag}]\n${JSON.stringify(payload, null, 2)}`);
  } catch {
    console.log(`[LAUNCH_BATCH:${tag}]`, payload);
  }
}

/**
 * First touch when parent exists during one-click launch (first color materialized).
 */
async function setLaunchStatusMaterializing({ db, admin, sanitizeForFirestore, productId, userId }) {
  const ref = db.collection("rp_products").doc(productId);
  await ref.set(
    sanitizeForFirestore({
      launchStatus: LAUNCH_STATUS.MATERIALIZING,
      launchSource: "one_click",
      launchStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
    }),
    { merge: true }
  );
}

/**
 * Deterministic defaults for gallery / hero hints + readiness scaffolding (Phase 1).
 */
async function applyLaunchMetadataDefaults({ db, admin, sanitizeForFirestore, productId, blankId }) {
  const productRef = db.collection("rp_products").doc(productId);
  const [pSnap, bSnap] = await Promise.all([
    productRef.get(),
    blankId ? db.collection("rp_blanks").doc(blankId).get() : Promise.resolve(null),
  ]);
  if (!pSnap.exists) return;
  const p = pSnap.data() || {};
  const blank = bSnap && bSnap.exists ? bSnap.data() || {} : {};
  const styleCode = String(p.blankStyleCode || blank.styleCode || "").trim();

  const patch = {
    defaultGalleryRoleOrder: [...DEFAULT_ASSET_PLAN],
    launchPipelineVersion: 1,
    launchMetadataFilledAt: admin.firestore.FieldValue.serverTimestamp(),
    launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (styleCode === "8394") {
    patch.heroSelectionRule = "8394_primary_back_preference";
    patch.featuredImagePreference = "hero_back_then_front";
  }

  patch.linkedBlankId = blankId || p.blankId || null;
  patch.linkedDesignId = p.designId || null;
  patch.linkedTeamId = p.teamId || null;

  await productRef.set(sanitizeForFirestore(patch), { merge: true });
}

async function setLaunchStatusGeneratingAssets({ db, admin, sanitizeForFirestore, productId, userId }) {
  await db
    .collection("rp_products")
    .doc(productId)
    .set(
      sanitizeForFirestore({
        launchStatus: LAUNCH_STATUS.GENERATING_ASSETS,
        launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId,
      }),
      { merge: true }
    );
}

/**
 * After asset batch completes: evaluate Shopify readiness, set launchStatus + shopifyReady.
 * @param {object} ctx
 * @param {{ autoSyncShopify?: boolean }} [ctx.options]
 */
async function advanceLaunchAfterAssetBatchComplete({ db, admin, sanitizeForFirestore, productId, userId, options }) {
  const productRef = db.collection("rp_products").doc(productId);
  const vSnap = await productRef.collection("variants").get();
  const variantDocs = vSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const pSnap = await productRef.get();
  if (!pSnap.exists) return;
  const product = pSnap.data() || {};

  await applyLaunchMetadataDefaults({
    db,
    admin,
    sanitizeForFirestore,
    productId,
    blankId: product.blankId,
  });

  let fulfillmentResult = null;
  let fulfillmentThrown = null;
  try {
    fulfillmentResult = await buildFulfillmentPackage({ db, admin, sanitizeForFirestore, productId });
  } catch (fe) {
    fulfillmentThrown = fe && fe.message ? String(fe.message) : String(fe);
    console.warn("[advanceLaunchAfterAssetBatchComplete] fulfillment:", fulfillmentThrown);
  }

  const readiness = shopifySync.readinessCheck(product, { variantDocs });

  const patch = {
    launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    shopifyReadinessMissing: readiness.missing.length ? readiness.missing : admin.firestore.FieldValue.delete(),
    /** Technical readiness for Shopify payload (operator may still need to approve). */
    shopifyReady: readiness.ready,
  };

  if (readiness.ready) {
    if (fulfillmentThrown) {
      Object.assign(
        patch,
        pipelineFailurePatch(
          admin,
          `Fulfillment package build failed: ${fulfillmentThrown}`,
          PIPELINE_STAGE.FULFILLMENT
        )
      );
      patch.launchStatus = LAUNCH_STATUS.ASSEMBLING_METADATA;
    } else {
      const fulfillmentOk =
        fulfillmentResult && fulfillmentResult.ok && fulfillmentResult.fulfillmentSummary
          ? fulfillmentResult.fulfillmentSummary.fulfillmentReady === true
          : false;
      if (!fulfillmentOk) {
        const miss = fulfillmentResult?.fulfillmentSummary?.fulfillmentMissing;
        const missStr = Array.isArray(miss) && miss.length ? miss.join(", ") : "unknown";
        const reason =
          fulfillmentResult && fulfillmentResult.ok === false && fulfillmentResult.reason
            ? String(fulfillmentResult.reason)
            : null;
        Object.assign(
          patch,
          pipelineFailurePatch(
            admin,
            reason === "missing_design_or_blank"
              ? "Fulfillment: missing blankId or designId on product"
              : `Fulfillment package incomplete (${missStr})`,
            PIPELINE_STAGE.FULFILLMENT
          )
        );
        patch.launchStatus = LAUNCH_STATUS.ASSEMBLING_METADATA;
      } else if (skipReviewGate()) {
        Object.assign(patch, pipelineClearErrorPatch(admin));
        patch.launchStatus = LAUNCH_STATUS.SHOPIFY_READY;
        patch.opsReviewStatus = "skipped";
      } else {
        Object.assign(patch, pipelineClearErrorPatch(admin));
        patch.launchStatus = LAUNCH_STATUS.NEEDS_REVIEW;
        patch.opsReviewStatus = "pending";
        patch.reviewRequestedAt = admin.firestore.FieldValue.serverTimestamp();
      }
    }
  } else {
    const miss = readiness.missing.length ? readiness.missing.join("; ") : "unknown gaps";
    Object.assign(
      patch,
      pipelineFailurePatch(admin, `Shopify readiness incomplete: ${miss}`, PIPELINE_STAGE.ASSEMBLING_METADATA)
    );
    patch.launchStatus = LAUNCH_STATUS.ASSEMBLING_METADATA;
  }

  const fs = fulfillmentResult && fulfillmentResult.fulfillmentSummary ? fulfillmentResult.fulfillmentSummary : null;
  launchBatchLog("FULFILLMENT", {
    productId,
    fulfillmentSummaryCreated: !!(fulfillmentResult && fulfillmentResult.ok && fs),
    fulfillmentReady: fs ? fs.fulfillmentReady : null,
    fulfillmentMissing: fs && fs.fulfillmentMissing ? fs.fulfillmentMissing : null,
    fulfillmentThrown: fulfillmentThrown || null,
  });
  launchBatchLog("READINESS", {
    productId,
    shopifyReady: readiness.ready,
    shopifyReadinessMissing: readiness.missing || [],
    nextLaunchStatus: patch.launchStatus || null,
  });

  await productRef.set(sanitizeForFirestore(patch), { merge: true });

  const autoSync = options && options.autoSyncShopify === true;
  const fulfillmentReadyForSync =
    !fulfillmentThrown &&
    fulfillmentResult &&
    fulfillmentResult.ok &&
    fulfillmentResult.fulfillmentSummary &&
    fulfillmentResult.fulfillmentSummary.fulfillmentReady === true;
  if (readiness.ready && fulfillmentReadyForSync && autoSync && skipReviewGate()) {
    await db.collection("shopifySyncJobs").add(
      sanitizeForFirestore({
        entityType: "product",
        entityId: productId,
        action: "create_or_update",
        status: "queued",
        source: "launch_pipeline",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: userId || "system",
      })
    );
    await productRef.set(
      sanitizeForFirestore({
        launchStatus: LAUNCH_STATUS.SYNCING_SHOPIFY,
        launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPipelineStage: PIPELINE_STAGE.SHOPIFY_SYNC,
        lastPipelineAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPipelineError: admin.firestore.FieldValue.delete(),
      }),
      { merge: true }
    );
  }
}

/**
 * Partial / failed asset batch → operator-friendly status.
 */
async function advanceLaunchAfterAssetBatchTerminal({ db, admin, sanitizeForFirestore, productId, batchStatus, userId }) {
  const productRef = db.collection("rp_products").doc(productId);
  const patch = {
    launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: userId || "system",
  };
  if (batchStatus === "failed") {
    patch.launchStatus = LAUNCH_STATUS.FAILED;
    Object.assign(
      patch,
      pipelineFailurePatch(
        admin,
        "Initial asset batch finished with status: failed",
        PIPELINE_STAGE.GENERATING_ASSETS
      )
    );
  } else if (batchStatus === "partial") {
    patch.launchStatus = LAUNCH_STATUS.GENERATING_ASSETS;
    Object.assign(
      patch,
      pipelineFailurePatch(
        admin,
        "Initial asset batch finished with partial completion; review variant assets",
        PIPELINE_STAGE.GENERATING_ASSETS
      )
    );
  }
  await productRef.set(sanitizeForFirestore(patch), { merge: true });
}

module.exports = {
  LAUNCH_STATUS,
  PIPELINE_STAGE,
  DEFAULT_ASSET_PLAN,
  skipReviewGate,
  setLaunchStatusMaterializing,
  applyLaunchMetadataDefaults,
  setLaunchStatusGeneratingAssets,
  advanceLaunchAfterAssetBatchComplete,
  advanceLaunchAfterAssetBatchTerminal,
};
