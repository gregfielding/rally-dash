"use strict";

const {
  DEFAULT_ASSET_PLAN,
  OFFICIAL_MODEL_ROLES,
  OFFICIAL_REQUIRED_LAUNCH_ROLES,
} = require("./defaultAssetPlan");
const { isOfficialModelRoleName } = require("./blankProductImagePlan");
const { logOfficialAssetBatchRollup } = require("./officialAssetPipelineLog");
const { DEFAULT_8394_ASSET_PLAN } = require("./default8394AssetPlan");
const { getVariantModelBackUrl, getVariantModelFrontUrl } = require("./variantRenderSources");

/**
 * @param {boolean} canEnqueueModelRoles — identity id present + rp_identities doc exists (AI on-model path)
 * @param {import("firebase-admin").firestore.FieldValue} now
 * @param {{ back?: boolean; front?: boolean }} [nativeModel] — saved blank master has on-model URLs for this color
 */
/**
 * @param {string[]} officialRolesOrdered — from `resolveBlankProductImagePlan` for this color (enabled slots).
 */
function emptyRoleMap(canEnqueueModelRoles, now, nativeModel, officialRolesOrdered) {
  /* Legacy fallback only when caller did not pass plan-derived roles (older code paths / defensive). */
  const roleList =
    Array.isArray(officialRolesOrdered) && officialRolesOrdered.length ? officialRolesOrdered : [...DEFAULT_ASSET_PLAN];
  const nm =
    nativeModel && typeof nativeModel === "object"
      ? { back: !!nativeModel.back, front: !!nativeModel.front }
      : { back: false, front: false };
  /** @type {Record<string, { status: string; reason?: string; updatedAt?: unknown }>} */
  const m = {};
  for (const r of roleList) {
    if (!canEnqueueModelRoles && isOfficialModelRoleName(r)) {
      if (r === "model_back_designed" && nm.back) {
        m[r] = { status: "queued" };
      } else if (r === "model_front_clean" && nm.front) {
        m[r] = { status: "queued" };
      } else {
        m[r] = {
          status: "skipped_no_identity",
          reason: "Optional model assets skipped — no model identity configured.",
          updatedAt: now,
        };
      }
    } else {
      m[r] = { status: "queued" };
    }
  }
  return m;
}

/**
 * Batch fails only when a **required** (flat) role fails. Model roles can be skipped_no_identity or optional_failed.
 */
function requiredLaunchRolesForColor(colorBlock) {
  const op = colorBlock && colorBlock.officialPlan && typeof colorBlock.officialPlan === "object" ? colorBlock.officialPlan : null;
  const req = op && Array.isArray(op.requiredLaunchOfficialRoles) ? op.requiredLaunchOfficialRoles : null;
  /* Legacy fallback: both flat roles — used when batch has no officialPlan snapshot (pre-migration docs). */
  return req && req.length ? req : [...OFFICIAL_REQUIRED_LAUNCH_ROLES];
}

function allTrackedRolesForColor(colorBlock) {
  const roles = (colorBlock && colorBlock.roles) || {};
  return Object.keys(roles);
}

function deriveBatchStatus(colors) {
  const keys = Object.keys(colors || {});
  if (keys.length === 0) return "complete";

  for (const k of keys) {
    const block = colors[k] || {};
    const roles = block.roles || {};
    for (const r of requiredLaunchRolesForColor(block)) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "failed") return "failed";
    }
  }

  for (const k of keys) {
    const block = colors[k] || {};
    const roles = block.roles || {};
    for (const r of allTrackedRolesForColor(block)) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "running") return "running";
    }
  }

  for (const k of keys) {
    const block = colors[k] || {};
    const roles = block.roles || {};
    for (const r of allTrackedRolesForColor(block)) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (st === "queued") return "queued";
    }
  }

  return "complete";
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
  if (states.some((s) => s === "optional_failed")) return "optional_failed";
  if (states.every((s) => s === "skipped_no_identity")) return "skipped_no_identity";
  if (states.some((s) => s === "skipped_no_identity") && states.some((s) => s === "done")) return "done";
  if (states.some((s) => s === "skipped_no_identity")) return "skipped_no_identity";
  if (states.every((s) => s === "done")) return "done";
  return "idle";
}

function summarizeParentAssets(colors) {
  /** @type {Record<string, string>} */
  const assets = {};
  const roleSet = new Set();
  for (const c of Object.values(colors || {})) {
    for (const r of allTrackedRolesForColor(c)) roleSet.add(r);
  }
  if (roleSet.size === 0) {
    /* Legacy fallback: empty `colors[].roles` (unexpected) — parent rollup still needs a stable role key list. */
    for (const r of DEFAULT_ASSET_PLAN) roleSet.add(r);
  }
  for (const r of roleSet) {
    assets[r] = aggregateRoleAcrossColors(colors, r);
  }
  return assets;
}

function assetsProgressFromColors(colors) {
  let done = 0;
  let total = 0;
  for (const c of Object.values(colors || {})) {
    const roles = c && c.roles ? c.roles : {};
    const keys = Object.keys(roles);
    total += keys.length;
    for (const r of keys) {
      const st = roles[r] && roles[r].status ? String(roles[r].status) : "queued";
      if (
        st === "done" ||
        st === "skipped_no_identity" ||
        st === "optional_failed" ||
        (isOfficialModelRoleName(r) && st === "failed")
      ) {
        done += 1;
      }
    }
  }
  return { completed: done, total };
}

/** Scan batch.colors for failed roles (stable order) for FINAL_FAIL_REASON logging. */
function collectBatchFailureDetails(colors) {
  const failedRoles = [];
  let firstError = null;
  let firstRoleErrorMessage = null;
  const colorKeys = Object.keys(colors || {}).sort();
  for (const k of colorKeys) {
    const block = colors[k] || {};
    const roles = block.roles || {};
    const reqList = requiredLaunchRolesForColor(block);
    for (const r of reqList) {
      const o = roles[r];
      if (o && String(o.status) === "failed") {
        const err = o.error != null ? String(o.error) : "";
        failedRoles.push({ blankVariantId: k, role: r, error: err || null });
        if (!firstError && err) firstError = `${k}/${r}: ${err}`;
        if (!firstRoleErrorMessage && err) firstRoleErrorMessage = err;
      }
    }
  }
  return { failedRoles, firstError, firstRoleErrorMessage };
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
      generatedRenderOutputs: pv.generatedRenderOutputs ?? null,
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

/**
 * Back-only commerce: `flat_front_clean` is not required for batch/launch terminal — failures become `optional_failed`.
 * Uses `readinessPrintSides` on the batch when present; otherwise resolves from product blank+design (legacy batches).
 */
async function resolveBackOnlyFlatFrontCleanOptional({ db, batchData, productId }) {
  const rp = batchData && batchData.readinessPrintSides;
  if (rp && typeof rp === "object" && "effectiveBack" in rp && "effectiveFront" in rp) {
    return rp.effectiveBack === true && rp.effectiveFront === false;
  }
  try {
    const { resolvePrintSidesForProductBuild } = require("./resolveDefaultPrintSides");
    const pSnap = await db.collection("rp_products").doc(productId).get();
    if (!pSnap.exists) return false;
    const p = pSnap.data() || {};
    const bid = p.blankId && String(p.blankId).trim();
    const designId = p.designId && String(p.designId).trim();
    if (!bid || !designId) return false;
    const [bSnap, dSnap] = await Promise.all([
      db.collection("rp_blanks").doc(bid).get(),
      db.collection("designs").doc(designId).get(),
    ]);
    if (!bSnap.exists || !dSnap.exists) return false;
    const sides = resolvePrintSidesForProductBuild(bSnap.data() || {}, dSnap.data() || {});
    return sides.effectiveBack === true && sides.effectiveFront === false;
  } catch {
    return false;
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

  let firstRoleErrorMessage = null;
  if (status === "failed") {
    const { failedRoles, firstError, firstRoleErrorMessage: frErr } = collectBatchFailureDetails(colors);
    firstRoleErrorMessage = frErr || null;
    launchBatchLog("FINAL_FAIL_REASON", {
      batchId,
      productId,
      completed: assetsProgress.completed,
      total: assetsProgress.total,
      failedRoles,
      firstError: firstError || null,
      firstRoleErrorMessage: firstRoleErrorMessage || null,
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

  /** One-line proof for blank+design-only runs: required flats vs model skips, terminal batch status. */
  try {
    const roleSnapshotByColor = {};
    const colorKeys = Object.keys(colors || {}).sort();
    for (const k of colorKeys) {
      const block = colors[k] || {};
      const roles = block.roles || {};
      const req = {};
      for (const r of requiredLaunchRolesForColor(block)) {
        req[r] = roles[r] && roles[r].status ? String(roles[r].status) : null;
      }
      const model = {};
      for (const r of OFFICIAL_MODEL_ROLES) {
        model[r] = roles[r] && roles[r].status ? String(roles[r].status) : null;
      }
      roleSnapshotByColor[k] = { required: req, model };
    }
    launchBatchLog("PROOF_BATCH_TERMINAL", {
      productId,
      batchId,
      batchStatus: status,
      officialModelRolesEnabled: b.officialModelRolesEnabled === true,
      requiredLaunchRolesNote: "per-color officialPlan.requiredLaunchOfficialRoles when present",
      roleSnapshotByColor,
      assetsProgress,
      blankDesignOnlyPath:
        b.officialModelRolesEnabled === false && b.launchPipeline === true,
    });
  } catch (pe) {
    console.warn("[recomputeAndSyncParent] PROOF_BATCH_TERMINAL log:", pe && pe.message ? pe.message : pe);
  }

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
        firstRoleErrorMessage,
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

  let backOnlyFlatFrontOptional = false;
  if (!ok && role === "flat_front_clean") {
    backOnlyFlatFrontOptional = await resolveBackOnlyFlatFrontCleanOptional({ db, batchData: b, productId });
  }

  if (ok) {
    roles[role] = {
      status: "done",
      generationJobId: jobId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  } else {
    const err = errorMessage ? String(errorMessage).slice(0, 500) : "failed";
    const optionalModel = isOfficialModelRoleName(role);
    const optionalFlatFront = role === "flat_front_clean" && backOnlyFlatFrontOptional === true;
    const optionalTerminal = optionalModel || optionalFlatFront;
    roles[role] = {
      status: optionalTerminal ? "optional_failed" : "failed",
      error: err,
      generationJobId: jobId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    launchBatchLog(optionalTerminal ? "ROLE_OPTIONAL_FAILED" : "ROLE_MARK_FAILED", {
      batchId,
      blankVariantId: colorKey,
      role,
      reason: err,
      backOnlyFlatFrontOptional: optionalFlatFront || undefined,
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
    status: ok
      ? "done"
      : isOfficialModelRoleName(role) || (!ok && role === "flat_front_clean" && backOnlyFlatFrontOptional)
        ? "optional_failed"
        : "failed",
    generationJobId: jobId || null,
  });

  await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId });
}

/**
 * Model role skipped in official enqueue (no AI path) — must not leave batch role stuck `queued`.
 */
async function markOfficialAssetRoleSkippedNoIdentity({
  db,
  admin,
  sanitizeForFirestore,
  productId,
  batchId,
  colorKey,
  role,
  reason,
}) {
  const batchRef = db.collection("rp_product_asset_batches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) return;

  const b = batchSnap.data() || {};
  const colors = { ...(b.colors || {}) };
  const colorBlock = { ...(colors[colorKey] || {}) };
  const roles = { ...(colorBlock.roles || {}) };

  roles[role] = {
    status: "skipped_no_identity",
    reason: reason ? String(reason).slice(0, 400) : "Optional model assets skipped — no model identity configured.",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

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
    status: "skipped_no_identity",
    generationJobId: null,
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
  OFFICIAL_MODEL_ROLES,
  OFFICIAL_REQUIRED_LAUNCH_ROLES,
  DEFAULT_8394_ASSET_PLAN,
  emptyRoleMap,
  deriveBatchStatus,
  summarizeParentAssets,
  assetsProgressFromColors,
  applyPrimaryVariantMediaInheritance,
  recomputeAndSyncParent,
  markOfficialAssetRoleTerminal,
  markOfficialAssetRoleSkippedNoIdentity,
  on8394SecondaryPipelineMediaInheritance,
  supersedeOpenBatchesForProduct,
  launchBatchLog,
};
