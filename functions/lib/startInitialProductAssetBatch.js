"use strict";

const { DEFAULT_8394_ASSET_PLAN } = require("./default8394AssetPlan");
const { resolveModelIdentity } = require("./resolveModelIdentity");
const { queueVariant8394BaseAssets } = require("./variant8394Pipeline");
const {
  emptyRoleMap,
  recomputeAndSyncParent,
  supersedeOpenBatchesForProduct,
} = require("./productAssetBatchHelpers");

const SIZE_ORDER = { XS: 0, S: 1, M: 2, L: 3, XL: 4, XXL: 5, "2XL": 6, "3XL": 7 };

function sortSizeKey(sz) {
  const s = String(sz || "").trim();
  return SIZE_ORDER[s] != null ? SIZE_ORDER[s] : 99;
}

/**
 * Single orchestration entry for initial team-product 8394 assets (primary size per color).
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
 * @param {{ autoSyncShopify?: boolean }} [ctx.launchOptions] — stored on batch for post-complete Shopify step
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
  if (String(blank.styleCode || "").trim() !== "8394") {
    return {
      ok: true,
      skipped: true,
      reason: "not_8394",
      productId,
      assetsStatus: product.assetsStatus || "idle",
      assetsBatchId: product.assetsBatchId || null,
    };
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  const design = designSnap.exists ? designSnap.data() || {} : {};
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

  const batchRef = db.collection("rp_product_asset_batches").doc();
  const batchId = batchRef.id;

  /** @type {Record<string, object>} */
  const colors = {};
  /** @type {Array<{ blankVariantId: string, primaryVariantId: string }>} */
  const primaries = [];

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
    colors[blankVariantKey] = {
      blankVariantId: blankVariantKey,
      colorName: vr.colorName || (vr.optionValues && vr.optionValues.color) || null,
      primaryVariantId,
      roles: emptyRoleMap(),
    };
  }

  const colorCount = Object.keys(colors).length;
  const totalRoles = colorCount * DEFAULT_8394_ASSET_PLAN.length;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await batchRef.set(
    sanitizeForFirestore({
      productId,
      blankId,
      designId,
      teamId,
      status: "running",
      resolvedModelIdentityId: resolvedModelIdentityId || null,
      launchPipeline: !!(launchOptions && typeof launchOptions === "object"),
      launchOptions: launchOptions && typeof launchOptions === "object" ? launchOptions : null,
      colors,
      assetsProgress: { completed: 0, total: totalRoles },
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    })
  );

  await productRef.update(
    sanitizeForFirestore({
      assetsStatus: "running",
      assetsBatchId: batchId,
      assetsProgress: { completed: 0, total: totalRoles },
      assetsRoles: {},
      assetsUpdatedAt: now,
    })
  );

  await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId });

  let enqueueErrors = 0;
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

    let failed = false;
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
      failed = true;
      enqueueErrors += 1;
      console.error("[startInitialProductAssetBatch] queueVariant8394BaseAssets:", e && e.message ? e.message : e);
      const br = await batchRef.get();
      const bdata = br.data() || {};
      const col = { ...(bdata.colors || {}) };
      const block = { ...(col[blankVariantId] || {}) };
      const roles = { ...(block.roles || {}) };
      for (const role of DEFAULT_8394_ASSET_PLAN) {
        roles[role] = {
          status: "failed",
          error: e && e.message ? String(e.message).slice(0, 400) : "enqueue_failed",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
      block.roles = roles;
      col[blankVariantId] = block;
      await batchRef.update(sanitizeForFirestore({ colors: col, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    }

    if (!failed) {
      const snapAfter = await batchRef.get();
      const cdata = snapAfter.data() || {};
      const col2 = { ...(cdata.colors || {}) };
      const block2 = { ...(col2[blankVariantId] || {}) };
      const roles2 = { ...(block2.roles || {}) };
      for (const role of DEFAULT_8394_ASSET_PLAN) {
        roles2[role] = {
          status: "running",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
      block2.roles = roles2;
      col2[blankVariantId] = block2;
      await batchRef.update(sanitizeForFirestore({ colors: col2, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    }
    await recomputeAndSyncParent({ db, admin, sanitizeForFirestore, productId, batchId });
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
