"use strict";

const shopifySync = require("../shopifySync");
const { LEGACY_DEFAULT_ASSET_PLAN, resolveBlankProductImagePlan } = require("./defaultAssetPlan");
const { buildFulfillmentPackage } = require("./buildFulfillmentPackage");
const { resolvePrintSidesForProductBuild } = require("./resolveDefaultPrintSides");
const {
  describe8394ReadinessRoles,
  primaryVariantImageUrlForShopify,
  mergeInheritedMediaForReadiness8394,
} = require("./variantShopifyMedia");
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
 * @param {{ db: import("firebase-admin").firestore.Firestore; product: Record<string, unknown> }} ctx
 */
async function resolvePrintSidesPayloadForProduct({ db, product }) {
  if (product.fulfillmentSummary && product.fulfillmentSummary.printSides) {
    return product.fulfillmentSummary.printSides;
  }
  const blankId = product.blankId;
  const designId = product.designId;
  if (!blankId || !designId) return null;
  const [bSnap, dSnap] = await Promise.all([
    db.collection("rp_blanks").doc(String(blankId)).get(),
    db.collection("designs").doc(String(designId)).get(),
  ]);
  const sideRes = resolvePrintSidesForProductBuild(
    bSnap.exists ? bSnap.data() || {} : {},
    dSnap.exists ? dSnap.data() || {} : {}
  );
  return {
    blankMode: sideRes.blankMode,
    designMode: sideRes.designMode,
    effectiveFront: sideRes.effectiveFront,
    effectiveBack: sideRes.effectiveBack,
    primaryPlacementSide: sideRes.primaryPlacementSide,
    canGenerate: sideRes.canGenerate,
  };
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

  const bvKey = String(p.blankVariantId || "").trim();
  const blankRow =
    bvKey && Array.isArray(blank.variants) ? blank.variants.find((v) => v && String(v.variantId || "").trim() === bvKey) : null;
  const fallbackRow = Array.isArray(blank.variants) && blank.variants[0] ? blank.variants[0] : null;
  const rowForGallery = blankRow || fallbackRow;
  const resolvedGallery =
    rowForGallery && Object.keys(blank).length
      ? resolveBlankProductImagePlan(blank, rowForGallery)
      : null;
  const galleryOrder =
    resolvedGallery && resolvedGallery.galleryOrderOfficialRoles.length
      ? [...resolvedGallery.galleryOrderOfficialRoles]
      : [...LEGACY_DEFAULT_ASSET_PLAN];

  const patch = {
    defaultGalleryRoleOrder: galleryOrder,
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

  let printSidesPayload =
    fulfillmentResult && fulfillmentResult.ok && fulfillmentResult.fulfillmentSummary
      ? fulfillmentResult.fulfillmentSummary.printSides || null
      : null;
  if (!printSidesPayload) {
    printSidesPayload = await resolvePrintSidesPayloadForProduct({ db, product });
  }

  const readiness = shopifySync.readinessCheck(product, { variantDocs, printSides: printSidesPayload });

  const styleForLog = String(product.blankStyleCode || "").trim();
  if (styleForLog === "8394" && variantDocs.length > 0) {
    const byId = new Map(variantDocs.filter((v) => v.id).map((v) => [String(v.id), v]));
    const sample = variantDocs[0];
    const sampleMerged = sample ? mergeInheritedMediaForReadiness8394(sample, byId) : null;
    const primaryUrl = sampleMerged
      ? primaryVariantImageUrlForShopify(sampleMerged, product.blankStyleCode, printSidesPayload)
      : "";
    const fr = sampleMerged && sampleMerged.flatRenders;
    launchBatchLog("SHOPIFY_READINESS_CONTEXT", {
      productId,
      blankStyleCode: product.blankStyleCode || null,
      printSides: printSidesPayload,
      rolePolicy: describe8394ReadinessRoles(printSidesPayload),
      sampleVariantId: sample && sample.id,
      primaryStorefrontImageUrl: primaryUrl || null,
      fulfillmentPrintRefsSample: sampleMerged
        ? {
            flat_clean_front: fr && fr.flat_clean && fr.flat_clean.front ? fr.flat_clean.front.url : null,
            flat_blended_back: fr && fr.flat_blended && fr.flat_blended.back ? fr.flat_blended.back.url : null,
            heroFront: sampleMerged.media && sampleMerged.media.heroFront,
            heroBack: sampleMerged.media && sampleMerged.media.heroBack,
            mockupUrl: sampleMerged.mockupUrl || null,
          }
        : null,
    });
  }

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

  launchBatchLog("PROOF_LAUNCH_ADVANCE", {
    productId,
    launchStatus: patch.launchStatus || null,
    shopifyReady: patch.shopifyReady === true,
    shopifyReadinessMissing: readiness.missing || [],
    fulfillmentSummaryWritten: !!(fulfillmentResult && fulfillmentResult.ok && fs),
    fulfillmentReady: fs ? fs.fulfillmentReady === true : null,
    fulfillmentThrown: fulfillmentThrown || null,
    opsReviewStatus: patch.opsReviewStatus != null ? patch.opsReviewStatus : null,
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
 * @param {string} [firstRoleErrorMessage] — first failed role's `error` from batch colors (root cause); preferred over generic text.
 */
async function advanceLaunchAfterAssetBatchTerminal({
  db,
  admin,
  sanitizeForFirestore,
  productId,
  batchStatus,
  userId,
  firstRoleErrorMessage,
}) {
  const productRef = db.collection("rp_products").doc(productId);
  const patch = {
    launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: userId || "system",
  };
  if (batchStatus === "failed") {
    patch.launchStatus = LAUNCH_STATUS.FAILED;
    const detail =
      firstRoleErrorMessage && String(firstRoleErrorMessage).trim()
        ? String(firstRoleErrorMessage).trim()
        : "Initial asset batch finished with status: failed";
    Object.assign(patch, pipelineFailurePatch(admin, detail, PIPELINE_STAGE.GENERATING_ASSETS));
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
  DEFAULT_ASSET_PLAN: LEGACY_DEFAULT_ASSET_PLAN,
  skipReviewGate,
  setLaunchStatusMaterializing,
  applyLaunchMetadataDefaults,
  setLaunchStatusGeneratingAssets,
  advanceLaunchAfterAssetBatchComplete,
  advanceLaunchAfterAssetBatchTerminal,
};
