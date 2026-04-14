"use strict";

const { DEFAULT_ASSET_PLAN } = require("./defaultAssetPlan");
const { logOfficialAssetBatchRollup } = require("./officialAssetPipelineLog");
const { DEFAULT_8394_ASSET_PLAN } = require("./default8394AssetPlan");

function emptyRoleMap() {
  /** @type {Record<string, { status: string }>} */
  const m = {};
  for (const r of DEFAULT_ASSET_PLAN) {
    m[r] = { status: "queued" };
  }
  return m;
}

function deriveBatchStatus(colors) {
  const keys = Object.keys(colors || {});
  if (keys.length === 0) return "complete";
  const totalSlots = keys.length * DEFAULT_ASSET_PLAN.length;
  let doneC = 0;
  let failC = 0;
  let runC = 0;
  let qC = 0;
  for (const k of keys) {
    const roles = colors[k].roles || {};
    for (const r of DEFAULT_ASSET_PLAN) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "done") doneC += 1;
      else if (st === "failed") failC += 1;
      else if (st === "running") runC += 1;
      else qC += 1;
    }
  }
  if (doneC === totalSlots) return "complete";
  if (failC > 0 && runC === 0 && qC === 0) return failC === totalSlots ? "failed" : "partial";
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
  for (const r of DEFAULT_ASSET_PLAN) {
    assets[r] = aggregateRoleAcrossColors(colors, r);
  }
  return assets;
}

function assetsProgressFromColors(colors) {
  let done = 0;
  const total = Object.keys(colors || {}).length * DEFAULT_ASSET_PLAN.length;
  for (const c of Object.values(colors || {})) {
    const roles = c && c.roles ? c.roles : {};
    for (const r of DEFAULT_ASSET_PLAN) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "done") done += 1;
    }
  }
  return { completed: done, total };
}

/** Scan batch.colors for failed roles (stable order) for FINAL_FAIL_REASON logging. */
function collectBatchFailureDetails(colors) {
  const failedRoles = [];
  let firstError = null;
  const colorKeys = Object.keys(colors || {}).sort();
  for (const k of colorKeys) {
    const roles = (colors[k] && colors[k].roles) || {};
    for (const r of DEFAULT_ASSET_PLAN) {
      const o = roles[r];
      if (o && String(o.status) === "failed") {
        const err = o.error != null ? String(o.error) : "";
        failedRoles.push({ blankVariantId: k, role: r, error: err || null });
        if (!firstError && err) firstError = `${k}/${r}: ${err}`;
      }
    }
  }
  return { failedRoles, firstError };
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

function launchBatchLog(tag, payload) {
  try {
    console.log(`[LAUNCH_BATCH:${tag}]\n${JSON.stringify(payload, null, 2)}`);
  } catch {
    console.log(`[LAUNCH_BATCH:${tag}]`, payload);
  }
}

async function recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId }) {
  const batchRef = db.collection("rp_product_asset_batches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) {
    launchBatchLog("ERROR", {
      productId,
      batchId,
      stage: "recomputeAndSyncParent",
      error: "batch_doc_missing",
    });
    return;
  }
  const b = batchSnap.data() || {};
  const colors = b.colors || {};
  let status;
  let assetsProgress;
  let assets;
  try {
    status = deriveBatchStatus(colors);
    assetsProgress = assetsProgressFromColors(colors);
    assets = summarizeParentAssets(colors);
  } catch (reErr) {
    launchBatchLog("ERROR", {
      productId,
      batchId,
      stage: "deriveBatchStatus",
      error: reErr && reErr.message ? String(reErr.message) : String(reErr),
    });
    throw reErr;
  }
  /** Parent `assetsStatus`: treat batch "queued" as in-flight work (roles not all terminal). */
  const assetsStatus =
    status === "complete"
      ? "complete"
      : status === "failed"
        ? "failed"
        : status === "partial"
          ? "partial"
          : status === "queued"
            ? "running"
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

  if (status === "failed") {
    const { failedRoles, firstError } = collectBatchFailureDetails(colors);
    launchBatchLog("FINAL_FAIL_REASON", {
      batchId,
      productId,
      completed: assetsProgress.completed,
      total: assetsProgress.total,
      failedRoles,
      firstError: firstError || null,
    });
  }

  launchBatchLog("ROLLUP", {
    productId,
    batchId,
    batchStatus: status,
    assetsStatus,
    assetsProgress,
    assetsRoles: assets,
    launchPipeline: b.launchPipeline === true,
  });

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
    launchBatchLog("ERROR", {
      productId,
      batchId,
      stage: "advanceLaunch",
      error: launchErr && launchErr.message ? String(launchErr.message) : String(launchErr),
    });
    console.warn("[recomputeAndSyncParent] launch advance:", launchErr && launchErr.message ? launchErr.message : launchErr);
  }

  try {
    const pRoll = await productRef.get();
    const pRollData = pRoll.exists ? pRoll.data() || {} : {};
    logOfficialAssetBatchRollup({
      productId,
      batchId,
      completed: assetsProgress.completed,
      total: assetsProgress.total,
      batchStatus: status,
      assetsStatus,
      launchStatus: pRollData.launchStatus != null ? pRollData.launchStatus : null,
    });
  } catch (rollErr) {
    console.warn("[recomputeAndSyncParent] OFFICIAL_ASSET_BATCH:ROLLUP:", rollErr && rollErr.message ? rollErr.message : rollErr);
  }
}

/**
 * Update one official asset role on `rp_product_asset_batches` (driven by `rp_generation_jobs`).
 */
async function markOfficialAssetRoleTerminal({
  db,
  admin,
  sanitizeForFirestore,
  productId,
  batchId,
  colorKey,
  role,
  ok,
  errorMessage,
  jobId,
}) {
  const batchRef = db.collection("rp_product_asset_batches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) return;

  const b = batchSnap.data() || {};
  const colors = { ...(b.colors || {}) };
  const colorBlock = { ...(colors[colorKey] || {}) };
  const roles = { ...(colorBlock.roles || {}) };

  if (ok) {
    roles[role] = {
      status: "done",
      generationJobId: jobId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  } else {
    const err = errorMessage ? String(errorMessage).slice(0, 500) : "failed";
    roles[role] = {
      status: "failed",
      error: err,
      generationJobId: jobId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    launchBatchLog("ROLE_MARK_FAILED", {
      batchId,
      blankVariantId: colorKey,
      role,
      reason: err,
    });
  }

  colorBlock.roles = roles;
  colors[colorKey] = colorBlock;

  await batchRef.update(
    sanitizeForFirestore({
      colors,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  );

  launchBatchLog("ROLE_FINISH", {
    productId,
    batchId,
    blankVariantId: colorKey,
    role,
    status: ok ? "done" : "failed",
    generationJobId: jobId || null,
  });

  await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId });
}

/**
 * 8394 mock/flat is secondary: refresh sibling media only — does not drive asset batch / launch gates.
 */
async function on8394SecondaryPipelineMediaInheritance({ db, admin, parentId, productVariantId, succeeded }) {
  if (!succeeded) return;
  await applyPrimaryVariantMediaInheritance({ db, admin, parentId, primaryVariantId: productVariantId });
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
  DEFAULT_ASSET_PLAN,
  DEFAULT_8394_ASSET_PLAN,
  emptyRoleMap,
  deriveBatchStatus,
  summarizeParentAssets,
  assetsProgressFromColors,
  applyPrimaryVariantMediaInheritance,
  recomputeAndSyncParent,
  markOfficialAssetRoleTerminal,
  on8394SecondaryPipelineMediaInheritance,
  supersedeOpenBatchesForProduct,
  launchBatchLog,
};
