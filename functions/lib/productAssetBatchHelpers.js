"use strict";

const { DEFAULT_8394_ASSET_PLAN } = require("./default8394AssetPlan");

function emptyRoleMap() {
  /** @type {Record<string, { status: string }>} */
  const m = {};
  for (const r of DEFAULT_8394_ASSET_PLAN) {
    m[r] = { status: "queued" };
  }
  return m;
}

function deriveBatchStatus(colors) {
  const keys = Object.keys(colors || {});
  if (keys.length === 0) return "complete";
  let doneC = 0;
  let failC = 0;
  let runC = 0;
  let qC = 0;
  for (const k of keys) {
    const roles = colors[k].roles || {};
    for (const r of DEFAULT_8394_ASSET_PLAN) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "done") doneC += 1;
      else if (st === "failed") failC += 1;
      else if (st === "running") runC += 1;
      else qC += 1;
    }
  }
  if (doneC === total) return "complete";
  if (failC > 0 && runC === 0 && qC === 0) return failC === total ? "failed" : "partial";
  if (runC > 0) return "running";
  return "queued";
}

function aggregateRoleAcrossColors(colors, roleKey) {
  const states = [];
  for (const c of Object.values(colors || {})) {
    const roles = c && c.roles ? c.roles : {};
    const st = roles[roleKey] && roles[roleKey].status ? String(roles[roleKey].status) : "queued";
    states.push(st);
  }
  if (states.length === 0) return "idle";
  if (states.some((s) => s === "failed")) return "failed";
  if (states.some((s) => s === "running")) return "running";
  if (states.some((s) => s === "queued")) return "queued";
  if (states.every((s) => s === "done")) return "done";
  return "idle";
}

function summarizeParentAssets(colors) {
  /** @type {Record<string, string>} */
  const assets = {};
  for (const r of DEFAULT_8394_ASSET_PLAN) {
    assets[r] = aggregateRoleAcrossColors(colors, r);
  }
  return assets;
}

function assetsProgressFromColors(colors) {
  let done = 0;
  const total = Object.keys(colors || {}).length * DEFAULT_8394_ASSET_PLAN.length;
  for (const c of Object.values(colors || {})) {
    const roles = c && c.roles ? c.roles : {};
    for (const r of DEFAULT_8394_ASSET_PLAN) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "done") done += 1;
    }
  }
  return { completed: done, total };
}

/**
 * Copy key media fields from primary variant to same-color siblings (non-primary sizes).
 */
async function applyPrimaryVariantMediaInheritance({ db, admin, parentId, primaryVariantId }) {
  const productRef = db.collection("rp_products").doc(parentId);
  const primaryRef = productRef.collection("variants").doc(primaryVariantId);
  const primarySnap = await primaryRef.get();
  if (!primarySnap.exists) return { ok: false, reason: "no_primary" };
  const pv = primarySnap.data() || {};
  const blankVariantId = pv.blankVariantId;
  if (!blankVariantId) return { ok: false, reason: "no_blank_variant" };

  const siblings = await productRef.collection("variants").where("blankVariantId", "==", blankVariantId).get();
  const batch = db.batch();
  let n = 0;
  for (const d of siblings.docs) {
    if (d.id === primaryVariantId) continue;
    const row = d.data() || {};
    if (row.inheritsMediaFromVariantId !== primaryVariantId) continue;
    batch.update(d.ref, {
      mockupUrl: pv.mockupUrl ?? null,
      media: pv.media ?? {},
      flatRenders: pv.flatRenders ?? null,
      sceneRenders: pv.sceneRenders ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: pv.updatedBy || "system",
    });
    n += 1;
  }
  if (n > 0) await batch.commit();
  return { ok: true, updated: n };
}

async function recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId }) {
  const batchRef = db.collection("rp_product_asset_batches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) return;
  const b = batchSnap.data() || {};
  const colors = b.colors || {};
  const status = deriveBatchStatus(colors);
  const assetsProgress = assetsProgressFromColors(colors);
  const assets = summarizeParentAssets(colors);
  const assetsStatus =
    status === "complete"
      ? "complete"
      : status === "failed"
        ? "failed"
        : status === "partial"
          ? "partial"
          : status === "queued"
            ? "queued"
            : "running";

  await batchRef.update(
    sanitizeForFirestore({
      status,
      assetsProgress,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  );

  const productRef = db.collection("rp_products").doc(productId);
  await productRef.update(
    sanitizeForFirestore({
      assetsStatus,
      assetsBatchId: batchId,
      assetsProgress,
      assetsRoles: assets,
      assetsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  );

  try {
    const {
      advanceLaunchAfterAssetBatchComplete,
      advanceLaunchAfterAssetBatchTerminal,
    } = require("./productLaunchStatus");
    if (b.launchPipeline !== true) {
      return;
    }
    const launchOpts = b.launchOptions || {};
    const createdBy = b.createdBy || "system";
    if (status === "complete") {
      await advanceLaunchAfterAssetBatchComplete({
        db,
        admin,
        sanitizeForFirestore,
        productId,
        userId: createdBy,
        options: launchOpts,
      });
    } else if (status === "failed") {
      await advanceLaunchAfterAssetBatchTerminal({
        db,
        admin,
        sanitizeForFirestore,
        productId,
        batchStatus: "failed",
        userId: createdBy,
      });
    } else if (status === "partial") {
      await advanceLaunchAfterAssetBatchTerminal({
        db,
        admin,
        sanitizeForFirestore,
        productId,
        batchStatus: "partial",
        userId: createdBy,
      });
    }
  } catch (launchErr) {
    console.warn("[recomputeAndSyncParent] launch advance:", launchErr && launchErr.message ? launchErr.message : launchErr);
  }
}

async function on8394FlatPipelineFinishedForBatch({
  db,
  admin,
  sanitizeForFirestore,
  parentId,
  productVariantId,
  succeeded,
  errorMessage,
}) {
  const variantRef = db.collection("rp_products").doc(parentId).collection("variants").doc(productVariantId);
  const vSnap = await variantRef.get();
  if (!vSnap.exists) return;
  const v = vSnap.data() || {};
  const batchId = v.productAssetBatchId && String(v.productAssetBatchId).trim() ? String(v.productAssetBatchId).trim() : null;
  const colorKey =
    v.productAssetColorKey && String(v.productAssetColorKey).trim()
      ? String(v.productAssetColorKey).trim()
      : v.blankVariantId && String(v.blankVariantId).trim()
        ? String(v.blankVariantId).trim()
        : null;
  if (!batchId || !colorKey) return;

  const batchRef = db.collection("rp_product_asset_batches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) return;

  const b = batchSnap.data() || {};
  const colors = { ...(b.colors || {}) };
  const colorBlock = { ...(colors[colorKey] || {}) };
  const roles = { ...(colorBlock.roles || {}) };

  for (const role of DEFAULT_8394_ASSET_PLAN) {
    if (succeeded) {
      roles[role] = {
        status: "done",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    } else {
      roles[role] = {
        status: "failed",
        error: errorMessage ? String(errorMessage).slice(0, 500) : "flat_pipeline_failed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    }
  }
  colorBlock.roles = roles;
  colorBlock.primaryVariantId = productVariantId;
  colors[colorKey] = colorBlock;

  await batchRef.update(
    sanitizeForFirestore({
      colors,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  );

  if (succeeded) {
    await applyPrimaryVariantMediaInheritance({ db, admin, parentId, primaryVariantId: productVariantId });
  }

  await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId: parentId, batchId });
}

async function supersedeOpenBatchesForProduct({ db, admin, sanitizeForFirestore, productId, userId }) {
  const snap = await db.collection("rp_product_asset_batches").where("productId", "==", productId).limit(25).get();
  const batch = db.batch();
  let k = 0;
  for (const d of snap.docs) {
    const st = d.data()?.status;
    if (st === "queued" || st === "running") {
      batch.update(d.ref, {
        status: "superseded",
        supersededAt: admin.firestore.FieldValue.serverTimestamp(),
        supersededBy: userId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      k += 1;
    }
  }
  if (k > 0) await batch.commit();
  return k;
}

module.exports = {
  DEFAULT_8394_ASSET_PLAN,
  emptyRoleMap,
  deriveBatchStatus,
  summarizeParentAssets,
  assetsProgressFromColors,
  applyPrimaryVariantMediaInheritance,
  recomputeAndSyncParent,
  on8394FlatPipelineFinishedForBatch,
  supersedeOpenBatchesForProduct,
};
