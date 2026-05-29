"use strict";

const { LEGACY_DEFAULT_ASSET_PLAN, resolveBlankProductImagePlan } = require("./defaultAssetPlan");
const { isPipelineReadyStyleCode } = require("./pipelineReadiness");
const { resolvePrintSidesForProductBuild } = require("./resolveDefaultPrintSides");
const { createCreateGenerationJob } = require("./createGenerationJobCore");
const { resolveModelIdentity } = require("./resolveModelIdentity");
const { queueVariant8394BaseAssets } = require("./variant8394Pipeline");
const { enqueueOfficialProductImages, resolveOfficialScenePresetIdForEnqueue } = require("./officialProductImageJobs");
const { logOfficialAssetBatchStart } = require("./officialAssetPipelineLog");
const {
  emptyRoleMap,
  recomputeAndSyncParent,
  supersedeOpenBatchesForProduct,
  launchBatchLog,
} = require("./productAssetBatchHelpers");
const { getVariantModelBackUrl, getVariantModelFrontUrl } = require("./variantRenderSources");

const SIZE_ORDER = { XS: 0, S: 1, M: 2, L: 3, XL: 4, XXL: 5, "2XL": 6, "3XL": 7 };

function sortSizeKey(sz) {
  const s = String(sz || "").trim();
  return SIZE_ORDER[s] != null ? SIZE_ORDER[s] : 99;
}

/** Best-effort flags for source images already on the primary variant doc (pre-pipeline). */
function variantSourceImageFlags(vr) {
  const fr = vr && vr.flatRenders ? vr.flatRenders : {};
  const u = (node) =>
    node && typeof node === "object" && node.url && String(node.url).trim() ? String(node.url).trim() : "";
  return {
    hasFlatFront: !!u(fr.flat_clean && fr.flat_clean.front),
    hasFlatBack: !!u(fr.flat_blended && fr.flat_blended.back),
    hasModelFront: !!u(fr.model_clean && fr.model_clean.front),
    hasModelBack: !!u(fr.model_blended && fr.model_blended.back),
  };
}

/**
 * Single orchestration entry for initial team-product 8394 assets (primary size per color).
 *
 * **Launch architecture:** Products are derivable from **blank** (operational/render template) +
 * **design** (creative input) only. Model identity / LoRA / manual Generate actions are optional
 * enhancements — they must not block creation or this batch. When identity is missing, model
 * official roles are skipped; flats still run; `launchPipeline` still advances readiness when
 * the batch completes successfully.
 *
 * @param {object} ctx
 * @param {FirebaseFirestore.Firestore} ctx.db
 * @param {typeof import("firebase-admin")} ctx.admin
 * @param {function} ctx.sanitizeForFirestore
 * @param {function} ctx.deriveSizesForProductMatrix
 * @param {string} ctx.productId
 * @param {string} ctx.userId
 * @param {string[]} [ctx.variantIds] — optional filter; defaults to all variants on product
 * @param {boolean} [ctx.force]
 * @param {{ autoSyncShopify?: boolean; queue8394Secondary?: boolean }} [ctx.launchOptions] — merged with defaults; stored on batch for post-complete Shopify step
 * @returns {Promise<object>}
 */
async function startInitialProductAssetBatch(ctx) {
  const {
    db,
    admin,
    sanitizeForFirestore,
    deriveSizesForProductMatrix,
    productId,
    userId,
    variantIds: variantIdsFilter,
    force,
    launchOptions,
  } = ctx;

  const resolvedLaunchOptions =
    launchOptions && typeof launchOptions === "object" && !Array.isArray(launchOptions)
      ? launchOptions
      : { autoSyncShopify: false, queue8394Secondary: false };

  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    return { ok: false, code: "not_found", message: "Product not found" };
  }
  const product = productSnap.data() || {};
  const blankId = product.blankId;
  const designId = product.designId;
  if (!blankId || !designId) {
    return { ok: false, code: "failed_precondition", message: "Product missing blankId or designId" };
  }

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) {
    return { ok: false, code: "not_found", message: "Blank not found" };
  }
  const blank = blankSnap.data();
  /**
   * Pipeline-ready gate (see functions/lib/pipelineReadiness.js).
   * Only blanks whose downstream renderer is wired today can queue an asset
   * batch. Until a blank is flipped to `pipelineReady: true` in the registry,
   * this returns a clear skip reason so the bulk-upload picker (which uses the
   * same registry) and this trigger agree.
   */
  if (!isPipelineReadyStyleCode(blank.styleCode)) {
    return {
      ok: true,
      skipped: true,
      reason: `pipeline_not_ready_for_styleCode_${String(blank.styleCode || "").trim() || "unknown"}`,
      productId,
      assetsStatus: product.assetsStatus || "idle",
      assetsBatchId: product.assetsBatchId || null,
    };
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  const design = designSnap.exists ? designSnap.data() || {} : {};
  /** Same print-side resolution as readiness / compose — stored on batch for terminal role rules. */
  const readinessPrintSides = resolvePrintSidesForProductBuild(blank, design);
  const teamId = design.teamId && String(design.teamId).trim() ? String(design.teamId).trim() : null;

  const existingBatches = await db.collection("rp_product_asset_batches").where("productId", "==", productId).limit(40).get();
  const open = existingBatches.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => b.status === "queued" || b.status === "running");
  if (open.length > 0 && !force) {
    const b0 = open[0];
    return {
      ok: false,
      code: "batch_in_progress",
      message: "An asset batch is already queued or running for this product",
      productId,
      assetsBatchId: b0.id,
      assetsStatus: product.assetsStatus || "running",
      queuedColorCount: 0,
      queuedRoleCount: 0,
    };
  }

  if (force && open.length > 0) {
    await supersedeOpenBatchesForProduct({ db, admin, sanitizeForFirestore, productId, userId });
  }

  const sizesList = deriveSizesForProductMatrix(blank);
  const primarySizeCode = sizesList && sizesList.length ? String(sizesList[0]) : "M";

  const allVariantsSnap = await productRef.collection("variants").get();
  /** @type {FirebaseFirestore.QueryDocumentSnapshot[]} */
  let docs = allVariantsSnap.docs;
  if (Array.isArray(variantIdsFilter) && variantIdsFilter.length > 0) {
    const allow = new Set(variantIdsFilter.map((x) => String(x)));
    docs = docs.filter((d) => allow.has(d.id));
  }

  /** @type {Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>} */
  const byColor = new Map();
  for (const d of docs) {
    const v = d.data() || {};
    const bk = v.blankVariantId && String(v.blankVariantId).trim() ? String(v.blankVariantId).trim() : null;
    if (!bk) continue;
    if (!byColor.has(bk)) byColor.set(bk, []);
    byColor.get(bk).push(d);
  }

  if (byColor.size === 0) {
    return { ok: false, code: "failed_precondition", message: "No variants with blankVariantId found" };
  }

  const resolvedModelIdentityId = await resolveModelIdentity({ db, teamId, blankId, designId });
  const identityIdStr =
    resolvedModelIdentityId && String(resolvedModelIdentityId).trim() ? String(resolvedModelIdentityId).trim() : "";
  let identityDocExists = false;
  if (identityIdStr) {
    const idSnap = await db.collection("rp_identities").doc(identityIdStr).get();
    identityDocExists = idSnap.exists;
  }
  /** Identity id + Firestore doc — required for **AI** on-model jobs; blank-native model URLs use deterministic compose instead. */
  const canEnqueueModelRoles = !!(identityIdStr && identityDocExists);

  const batchRef = db.collection("rp_product_asset_batches").doc();
  const batchId = batchRef.id;
  const now = admin.firestore.FieldValue.serverTimestamp();

  /** @type {Record<string, object>} */
  const colors = {};
  /** @type {Array<{ blankVariantId: string, primaryVariantId: string }>} */
  const primaries = [];

  let skippedModelSlotsForInitialProgress = 0;
  let anyNativeModelOnBatch = false;
  /** @type {Set<string>} */
  const unionOfficialRolesAcrossColors = new Set();

  for (const [blankVariantKey, group] of byColor.entries()) {
    let primaryDoc = group.find((d) => {
      const v = d.data() || {};
      const sz = v.optionValues && v.optionValues.size ? String(v.optionValues.size) : "";
      return sz === primarySizeCode;
    });
    if (!primaryDoc) {
      const sorted = [...group].sort((a, b) => {
        const sa = (a.data().optionValues && a.data().optionValues.size) || "";
        const sb = (b.data().optionValues && b.data().optionValues.size) || "";
        return sortSizeKey(sa) - sortSizeKey(sb);
      });
      primaryDoc = sorted[0];
    }
    if (!primaryDoc) continue;
    const primaryVariantId = primaryDoc.id;
    primaries.push({ blankVariantId: blankVariantKey, primaryVariantId });

    const vr = primaryDoc.data() || {};
    const blankVarRow = (blank.variants || []).find((v) => v.variantId === blankVariantKey) || null;
    const nativeModelBack = !!(blankVarRow && getVariantModelBackUrl(blank, blankVarRow));
    const nativeModelFront = !!(blankVarRow && getVariantModelFrontUrl(blank, blankVarRow));
    if (nativeModelBack || nativeModelFront) anyNativeModelOnBatch = true;
    if (!canEnqueueModelRoles) {
      skippedModelSlotsForInitialProgress += (!nativeModelBack ? 1 : 0) + (!nativeModelFront ? 1 : 0);
    }
    const officialResolved =
      blankVarRow && blank ? resolveBlankProductImagePlan(blank, blankVarRow) : null;
    const rolesOrdered =
      officialResolved && officialResolved.enabledOfficialRolesOrdered.length
        ? officialResolved.enabledOfficialRolesOrdered
        : [...LEGACY_DEFAULT_ASSET_PLAN];
    for (const r of rolesOrdered) unionOfficialRolesAcrossColors.add(r);

    colors[blankVariantKey] = {
      blankVariantId: blankVariantKey,
      colorName: vr.colorName || (vr.optionValues && vr.optionValues.color) || null,
      primaryVariantId,
      officialPlan: officialResolved
        ? {
            enabledOfficialRolesOrdered: officialResolved.enabledOfficialRolesOrdered,
            requiredLaunchOfficialRoles: officialResolved.requiredLaunchOfficialRoles,
            requiredShopifyOfficialRoles: officialResolved.requiredShopifyOfficialRoles,
            galleryOrderOfficialRoles: officialResolved.galleryOrderOfficialRoles,
          }
        : null,
      roles: emptyRoleMap(canEnqueueModelRoles, now, { back: nativeModelBack, front: nativeModelFront }, rolesOrdered),
    };

    const sz = vr.optionValues && vr.optionValues.size ? String(vr.optionValues.size) : "";
    const img = variantSourceImageFlags(vr);
    launchBatchLog("PRIMARY_VARIANT", {
      batchId,
      blankVariantId: blankVariantKey,
      colorName: colors[blankVariantKey].colorName,
      primaryVariantId,
      size: sz,
      hasFlatFront: img.hasFlatFront,
      hasFlatBack: img.hasFlatBack,
      hasModelFront: img.hasModelFront,
      hasModelBack: img.hasModelBack,
    });
  }

  const colorCount = Object.keys(colors).length;
  let totalRoles = 0;
  for (const c of Object.values(colors)) {
    const n = c && c.roles ? Object.keys(c.roles).length : 0;
    totalRoles += n;
  }
  const initialCompleted = !canEnqueueModelRoles ? skippedModelSlotsForInitialProgress : 0;

  await batchRef.set(
    sanitizeForFirestore({
      productId,
      blankId,
      designId,
      teamId,
      status: "running",
      resolvedModelIdentityId: resolvedModelIdentityId || null,
      officialModelRolesEnabled: canEnqueueModelRoles,
      launchPipeline: true,
      launchOptions: resolvedLaunchOptions,
      readinessPrintSides,
      colors,
      assetsProgress: { completed: initialCompleted, total: totalRoles },
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    })
  );

  launchBatchLog("PROOF_BATCH_CREATED", {
    productId,
    batchId,
    officialModelRolesEnabled: canEnqueueModelRoles,
    rolesExpectedToEnqueueUnion: Array.from(unionOfficialRolesAcrossColors),
    planSource: "resolveBlankProductImagePlan_per_color",
    modelRolesSkippedNoIdentity: !canEnqueueModelRoles,
    launchPipeline: true,
  });

  await productRef.update(
    sanitizeForFirestore({
      assetsStatus: "running",
      assetsBatchId: batchId,
      assetsProgress: { completed: initialCompleted, total: totalRoles },
      assetsRoles: {},
      assetsUpdatedAt: now,
      officialAssetsNote:
        !canEnqueueModelRoles && !anyNativeModelOnBatch
          ? "Optional model assets skipped — no model identity configured."
          : admin.firestore.FieldValue.delete(),
    })
  );

  launchBatchLog("START", {
    productId,
    batchId,
    queuedColorCount: colorCount,
    queuedRoleCount: totalRoles,
    launchPipeline: true,
    launchOptions: resolvedLaunchOptions,
  });

  const officialScenePresetIdResolved = await resolveOfficialScenePresetIdForEnqueue(db, product);
  logOfficialAssetBatchStart({
    productId,
    batchId,
    colors: Object.keys(colors),
    roles: Array.from(unionOfficialRolesAcrossColors),
    pipeline: "official_flat_compose_plus_model_jobs",
    resolvedModelIdentityId: resolvedModelIdentityId || null,
    officialScenePresetIdResolved: officialScenePresetIdResolved || null,
    officialModelRolesEnabled: canEnqueueModelRoles,
  });

  await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId });

  const createGenerationJob = createCreateGenerationJob({ db, admin, sanitizeForFirestore });
  const storage = admin.storage();

  for (const { blankVariantId, primaryVariantId } of primaries) {
    const vRef = productRef.collection("variants").doc(primaryVariantId);
    await vRef.update(
      sanitizeForFirestore({
        productAssetBatchId: batchId,
        productAssetColorKey: blankVariantId,
        isPrimaryForColor: true,
        inheritsMediaFromVariantId: null,
        updatedAt: now,
        updatedBy: userId,
      })
    );
  }

  let enqueueErrors = 0;
  let enqueueFailed = false;
  /** @type {string[]} */
  let rolesEnqueued = Array.from(unionOfficialRolesAcrossColors);
  try {
    const enqOut = await enqueueOfficialProductImages({
      db,
      admin,
      sanitizeForFirestore,
      storage,
      createGenerationJob,
      productId,
      userId,
      batchId,
      primaries,
      product,
      designId,
      resolvedModelIdentityId,
      canEnqueueModelRoles,
    });
    if (enqOut && Array.isArray(enqOut.rolesEnqueued)) rolesEnqueued = enqOut.rolesEnqueued;
  } catch (e) {
    enqueueFailed = true;
    enqueueErrors = primaries.length;
    console.error("[startInitialProductAssetBatch] enqueueOfficialProductImages:", e && e.message ? e.message : e);
    const failMsg = e && e.message ? String(e.message).slice(0, 400) : "enqueue_failed";
    try {
      console.log(
        "[OFFICIAL_ENQUEUE:MARK_FAILED]",
        JSON.stringify({
          productId,
          batchId,
          failedRoles: Array.from(unionOfficialRolesAcrossColors),
          reason: failMsg,
        })
      );
    } catch (_) {
      /* ignore */
    }
    for (const { blankVariantId } of primaries) {
      const rk = Object.keys((colors[blankVariantId] && colors[blankVariantId].roles) || {});
      const roleList = rk.length ? rk : [...LEGACY_DEFAULT_ASSET_PLAN];
      for (const role of roleList) {
        launchBatchLog("ROLE_MARK_FAILED", {
          batchId,
          blankVariantId,
          role,
          reason: failMsg,
        });
      }
    }
    const br = await batchRef.get();
    const bdata = br.data() || {};
    const col = { ...(bdata.colors || {}) };
    for (const { blankVariantId } of primaries) {
      const block = { ...(col[blankVariantId] || {}) };
      const roles = { ...(block.roles || {}) };
      const roleList = Object.keys(roles).length ? Object.keys(roles) : [...LEGACY_DEFAULT_ASSET_PLAN];
      for (const role of roleList) {
        const prev = roles[role];
        if (prev && String(prev.status) === "skipped_no_identity") continue;
        roles[role] = {
          status: "failed",
          error: failMsg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
      block.roles = roles;
      col[blankVariantId] = block;
    }
    await batchRef.update(sanitizeForFirestore({ colors: col, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
  }

  if (!enqueueFailed) {
    launchBatchLog("ROLE_ENQUEUE", {
      productId,
      batchId,
      colorKeys: primaries.map((p) => p.blankVariantId),
      rolesQueued: [...rolesEnqueued],
      pipeline: "official_flat_compose_plus_model_jobs",
    });
    const snapAfter = await batchRef.get();
    const cdata = snapAfter.data() || {};
    const col2 = { ...(cdata.colors || {}) };
    for (const { blankVariantId } of primaries) {
      const block2 = { ...(col2[blankVariantId] || {}) };
      const roles2 = { ...(block2.roles || {}) };
      for (const role of rolesEnqueued) {
        const prevSt = roles2[role] && roles2[role].status ? String(roles2[role].status) : "";
        if (prevSt === "done" || prevSt === "skipped_no_identity") {
          continue;
        }
        roles2[role] = {
          status: "running",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
      block2.roles = roles2;
      col2[blankVariantId] = block2;
    }
    await batchRef.update(sanitizeForFirestore({ colors: col2, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
  }

  await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId });

  /** Legacy MVP (`rp_mock_jobs` → `generateProductFlatRenders` / `variant_render_source`) — opt-in only; official batch is canonical. */
  const run8394Secondary = enqueueErrors === 0 && resolvedLaunchOptions && resolvedLaunchOptions.queue8394Secondary === true;
  if (run8394Secondary) {
    for (const { blankVariantId, primaryVariantId } of primaries) {
      try {
        await queueVariant8394BaseAssets({
          db,
          admin,
          sanitizeForFirestore,
          parentId: productId,
          variantId: primaryVariantId,
          userId,
          productAssetBatchId: batchId,
          productAssetColorKey: blankVariantId,
        });
      } catch (e) {
        console.warn("[startInitialProductAssetBatch] secondary 8394 queue:", e && e.message ? e.message : e);
      }
    }
  }

  const queuedColorCount = colorCount;
  const queuedRoleCount = totalRoles;

  return {
    ok: true,
    productId,
    assetsBatchId: batchId,
    assetsStatus: "running",
    resolvedModelIdentityId: resolvedModelIdentityId || null,
    queuedColorCount,
    queuedRoleCount,
    totalRoles,
    colorCount,
    enqueueErrors,
  };
}

module.exports = { startInitialProductAssetBatch };
