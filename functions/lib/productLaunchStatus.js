"use strict";

const shopifySync = require("../shopifySync");
const { DEFAULT_8394_ASSET_PLAN } = require("./default8394AssetPlan");

/** Operator-facing pipeline (parent `rp_products`). */
const LAUNCH_STATUS = {
  DRAFT: "draft",
  MATERIALIZING: "materializing",
  GENERATING_ASSETS: "generating_assets",
  ASSEMBLING_METADATA: "assembling_metadata",
  SHOPIFY_READY: "shopify_ready",
  SYNCING_SHOPIFY: "syncing_shopify",
  LIVE: "live",
  FAILED: "failed",
};

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
    defaultGalleryRoleOrder: [...DEFAULT_8394_ASSET_PLAN],
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

  const readiness = shopifySync.readinessCheck(product, { variantDocs });

  const patch = {
    launchUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    shopifyReadinessMissing: readiness.missing.length ? readiness.missing : admin.firestore.FieldValue.delete(),
    shopifyReady: readiness.ready,
  };

  if (readiness.ready) {
    patch.launchStatus = LAUNCH_STATUS.SHOPIFY_READY;
  } else {
    patch.launchStatus = LAUNCH_STATUS.ASSEMBLING_METADATA;
  }

  await productRef.set(sanitizeForFirestore(patch), { merge: true });

  const autoSync = options && options.autoSyncShopify === true;
  if (readiness.ready && autoSync) {
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
  } else if (batchStatus === "partial") {
    patch.launchStatus = LAUNCH_STATUS.GENERATING_ASSETS;
    patch.launchNote = "partial_asset_failure";
  }
  await productRef.set(sanitizeForFirestore(patch), { merge: true });
}

module.exports = {
  LAUNCH_STATUS,
  DEFAULT_8394_ASSET_PLAN,
  setLaunchStatusMaterializing,
  applyLaunchMetadataDefaults,
  setLaunchStatusGeneratingAssets,
  advanceLaunchAfterAssetBatchComplete,
  advanceLaunchAfterAssetBatchTerminal,
};
