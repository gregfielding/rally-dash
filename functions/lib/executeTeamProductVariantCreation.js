"use strict";

const { startInitialProductAssetBatch } = require("./startInitialProductAssetBatch");

function variantSummaryLen(pdata) {
  const vs = pdata && pdata.variantSummary;
  return Array.isArray(vs) ? vs.length : 0;
}

/**
 * Shared: multi-color loop + Firestore verify + initial asset batch.
 * Used by `createProductVariantsFromDesignBlank` and `launchProductsFromDesign`.
 *
 * @param {object} ctx
 * @param {FirebaseFirestore.Firestore} ctx.db
 * @param {typeof import("firebase-admin")} ctx.admin
 * @param {typeof import("firebase-functions")} ctx.functions
 * @param {function} ctx.runCreateProductFromDesignBlankCore
 * @param {function} ctx.designPngUrlForProcessing
 * @param {function} ctx.buildInitialRenderSetupForProduct
 * @param {function} ctx.resolveBlankVariantForProduct
 * @param {function} ctx.buildProductIdentityKey
 * @param {function} ctx.buildParentProductIdentityKey
 * @param {number} ctx.MASTER_BLANK_SCHEMA_VERSION
 * @param {function} ctx.sanitizeForFirestore
 * @param {function} ctx.deriveAvailableSizesFromBlank
 * @param {function} ctx.deriveSizesForProductMatrix
 * @param {object} ctx.merchandisingAtCreate
 * @param {object} ctx.resolveBlankTemplates
 * @param {string} ctx.designId
 * @param {string} ctx.blankId
 * @param {string[]} ctx.uniqueIds
 * @param {object|null} ctx.blankData
 * @param {string} ctx.uid
 * @param {boolean} [ctx.forceAssetBatch]
 * @param {{ autoSyncShopify?: boolean }} [ctx.launchOptions]
 * @param {function} [ctx.onColorCreated] async ({ productId, blankVariantId, out, createdColorIterations }) => void
 * @param {function} [ctx.afterVariantLoopBeforeAssets] async ({ lastProductId, results, createdColorCount }) => void
 * @returns {Promise<object>}
 */
async function executeTeamProductVariantCreation(ctx) {
  const {
    db,
    admin,
    functions,
    runCreateProductFromDesignBlankCore,
    designPngUrlForProcessing,
    buildInitialRenderSetupForProduct,
    resolveBlankVariantForProduct,
    buildProductIdentityKey,
    buildParentProductIdentityKey,
    MASTER_BLANK_SCHEMA_VERSION,
    sanitizeForFirestore,
    deriveAvailableSizesFromBlank,
    deriveSizesForProductMatrix,
    merchandisingAtCreate,
    resolveBlankTemplates,
    designId,
    blankId,
    uniqueIds,
    blankData,
    uid,
    forceAssetBatch,
    launchOptions,
    onColorCreated,
    afterVariantLoopBeforeAssets,
  } = ctx;

  const results = [];
  const errors = [];
  let lastProductId = null;
  let lastSlug = null;
  let createdColorIterations = 0;
  let skippedIterations = 0;
  let totalSkuWrites = 0;
  let parentMetaLogged = false;

  for (const blankVariantId of uniqueIds) {
    let colorName = null;
    try {
      if (blankData) {
        const vr = resolveBlankVariantForProduct(blankData, blankVariantId);
        colorName = vr?.colorName ?? null;
      }
    } catch (e) {
      colorName = null;
    }

    console.log(
      JSON.stringify({
        tag: "[TEAM_PRODUCT_GEN:SERVER:VARIANT:BEGIN]",
        blankVariantId,
        colorName,
      })
    );

    try {
      const out = await runCreateProductFromDesignBlankCore({
        db,
        admin,
        functions,
        designPngUrlForProcessing,
        buildInitialRenderSetupForProduct,
        resolveBlankVariantForProduct,
        buildProductIdentityKey,
        buildParentProductIdentityKey,
        MASTER_BLANK_SCHEMA_VERSION,
        sanitizeForFirestore,
        deriveAvailableSizesFromBlank,
        deriveSizesForProductMatrix,
        merchandisingAtCreate,
        resolveBlankTemplates,
        designId,
        blankId,
        blankVariantId,
        userId: uid,
      });
      lastProductId = out.productId;
      lastSlug = out.slug;
      const skuN = Array.isArray(out.variantIds) ? out.variantIds.length : 0;
      totalSkuWrites += skuN;
      createdColorIterations += 1;
      if (!parentMetaLogged && out.productId) {
        parentMetaLogged = true;
        console.log(
          JSON.stringify({
            tag: "[TEAM_PRODUCT_GEN:SERVER:PARENT]",
            parentProductId: out.productId,
            parentExisted: out.parentExisted === true,
            parentPath: `rp_products/${out.productId}`,
            parentSlug: out.slug || null,
          })
        );
      }
      results.push({
        blankVariantId,
        variantFirestoreId: out.variantId,
        variantFirestoreIds: out.variantIds,
        productId: out.productId,
        slug: out.slug,
        created: true,
      });
      if (typeof onColorCreated === "function") {
        try {
          await onColorCreated({
            productId: out.productId,
            blankVariantId,
            out,
            createdColorIterations,
          });
        } catch (hookErr) {
          console.warn("[executeTeamProductVariantCreation] onColorCreated:", hookErr && hookErr.message ? hookErr.message : hookErr);
        }
      }
      console.log(
        JSON.stringify({
          tag: "[TEAM_PRODUCT_GEN:SERVER:VARIANT:END]",
          blankVariantId,
          colorName,
          createdSkuCount: skuN,
          createdVariantDocIds: out.variantIds || [],
          productId: out.productId,
          slug: out.slug,
        })
      );
    } catch (e) {
      if (e instanceof functions.https.HttpsError && e.code === "already-exists") {
        const det = e.details && typeof e.details === "object" ? e.details : {};
        const pid = det.productId || lastProductId;
        const slug = det.slug || lastSlug;
        if (pid) lastProductId = pid;
        if (slug) lastSlug = slug;
        skippedIterations += 1;
        results.push({
          blankVariantId,
          created: false,
          skipped: true,
          productId: pid || null,
          slug: slug || null,
          message: e.message,
        });
        if (pid && !parentMetaLogged) {
          parentMetaLogged = true;
          console.log(
            JSON.stringify({
              tag: "[TEAM_PRODUCT_GEN:SERVER:PARENT]",
              parentProductId: pid,
              parentExisted: true,
              parentPath: `rp_products/${pid}`,
              parentSlug: slug || null,
              note: "from_already_exists_skip",
            })
          );
        }
        console.log(
          JSON.stringify({
            tag: "[TEAM_PRODUCT_GEN:SERVER:SKIP_REASON]",
            reason: "already_exists",
            blankVariantId,
            productId: pid || null,
            slug: slug || null,
            message: e.message,
            details: det,
          })
        );
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ blankVariantId, message: msg });
        console.log(
          JSON.stringify({
            tag: "[TEAM_PRODUCT_GEN:SERVER:SKIP_REASON]",
            reason: "error",
            blankVariantId,
            message: msg,
          })
        );
      }
    }
  }

  if (results.length === 0 && errors.length > 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      errors.map((x) => `${x.blankVariantId}: ${x.message}`).join(" | ")
    );
  }

  let variantSubdocCountVerified = null;
  if (lastProductId) {
    try {
      const parentRef = db.collection("rp_products").doc(lastProductId);
      const vSnap = await parentRef.collection("variants").get();
      variantSubdocCountVerified = vSnap.size;
      const distinctBlank = new Set();
      const distinctSizes = new Set();
      const exampleIds = [];
      for (const d of vSnap.docs) {
        const v = d.data();
        if (v.blankVariantId) distinctBlank.add(String(v.blankVariantId));
        const sz = v.optionValues && v.optionValues.size;
        if (sz) distinctSizes.add(String(sz));
        if (exampleIds.length < 5) exampleIds.push(d.id);
      }
      const parentSnap = await parentRef.get();
      const pdata = parentSnap.exists ? parentSnap.data() : {};
      console.log(
        JSON.stringify({
          tag: "[TEAM_PRODUCT_GEN:SERVER:FIRESTORE_VERIFY]",
          parentProductId: lastProductId,
          parentPath: `rp_products/${lastProductId}`,
          variantSubdocCount: vSnap.size,
          distinctBlankVariantIds: [...distinctBlank],
          distinctSizes: [...distinctSizes],
          exampleVariantDocIds: exampleIds,
          parentSummaryWritten: variantSummaryLen(pdata),
          colorVariantCountParentField: pdata.colorVariantCount ?? null,
          variantCountParentField: pdata.variantCount ?? null,
        })
      );
    } catch (verErr) {
      console.log(
        JSON.stringify({
          tag: "[TEAM_PRODUCT_GEN:SERVER:FIRESTORE_VERIFY]",
          error: verErr && verErr.message ? String(verErr.message) : String(verErr),
        })
      );
    }
  }

  const createdColorCount = results.filter((r) => r.created).length;

  const verificationPayload = {
    parentProductId: lastProductId,
    createdColorCount,
    createdSkuCount: totalSkuWrites,
    variantSubdocCountVerified,
  };

  console.log(
    JSON.stringify({
      tag: "[TEAM_PRODUCT_GEN:SERVER:RETURN_PAYLOAD]",
      ...verificationPayload,
    })
  );

  const allVariantIds = [];
  for (const r of results) {
    if (r.created && Array.isArray(r.variantFirestoreIds)) {
      allVariantIds.push(...r.variantFirestoreIds);
    }
  }
  const uniqueVariantIds = [...new Set(allVariantIds)];

  if (typeof afterVariantLoopBeforeAssets === "function" && lastProductId) {
    try {
      await afterVariantLoopBeforeAssets({
        lastProductId,
        results,
        createdColorCount,
        uniqueVariantIds,
      });
    } catch (hookErr) {
      console.warn("[executeTeamProductVariantCreation] afterVariantLoopBeforeAssets:", hookErr && hookErr.message ? hookErr.message : hookErr);
    }
  }

  console.log(
    JSON.stringify({
      tag: "[TEAM_PRODUCT_GEN:SERVER:SUMMARY]",
      parentProductId: lastProductId,
      parentSlug: lastSlug,
      createdColorCount: createdColorIterations,
      createdSkuApprox: totalSkuWrites,
      skippedCount: skippedIterations,
      errorCount: errors.length,
      resultLength: results.length,
    })
  );

  let assetBatch = null;
  if (lastProductId && uniqueVariantIds.length > 0 && createdColorCount > 0) {
    try {
      assetBatch = await startInitialProductAssetBatch({
        db,
        admin,
        sanitizeForFirestore,
        deriveSizesForProductMatrix,
        productId: lastProductId,
        variantIds: uniqueVariantIds,
        userId: uid,
        force: forceAssetBatch === true,
        launchOptions,
      });
    } catch (e) {
      console.error("[executeTeamProductVariantCreation] startInitialProductAssetBatch:", e && e.message ? e.message : e);
    }
  }

  return {
    ok: true,
    productId: lastProductId,
    slug: lastSlug,
    results,
    errors: errors.length ? errors : undefined,
    ...verificationPayload,
    assetsBatchId: assetBatch && assetBatch.assetsBatchId ? assetBatch.assetsBatchId : null,
    assetsStatus: assetBatch && assetBatch.assetsStatus != null ? assetBatch.assetsStatus : null,
    queuedColorCount: assetBatch && assetBatch.queuedColorCount != null ? assetBatch.queuedColorCount : null,
    queuedRoleCount: assetBatch && assetBatch.queuedRoleCount != null ? assetBatch.queuedRoleCount : null,
    assetBatch: assetBatch || null,
    createdColorIterations,
    skippedIterations,
    totalSkuWrites,
    uniqueVariantIds,
  };
}

module.exports = {
  executeTeamProductVariantCreation,
  variantSummaryLen,
};
