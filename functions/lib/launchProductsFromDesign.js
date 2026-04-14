"use strict";

const { executeTeamProductVariantCreation } = require("./executeTeamProductVariantCreation");
const {
  setLaunchStatusMaterializing,
  applyLaunchMetadataDefaults,
  setLaunchStatusGeneratingAssets,
} = require("./productLaunchStatus");

/**
 * One-click product launch: materialize Color × Size variants, enrich metadata, enqueue initial assets.
 * Coordinates with `launchPipeline` + `launchOptions` on `rp_product_asset_batches` for post-complete status.
 *
 * @param {object} ctx — same dependency bundle as `createProductVariantsFromDesignBlank` in index.js
 */
async function launchProductsFromDesign(ctx) {
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
    autoSyncShopify,
  } = ctx;

  const launchOptions = {
    autoSyncShopify: autoSyncShopify === true,
  };

  let materializingSet = false;

  const result = await executeTeamProductVariantCreation({
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
    onColorCreated: async ({ productId }) => {
      if (!materializingSet && productId) {
        materializingSet = true;
        await setLaunchStatusMaterializing({ db, admin, sanitizeForFirestore, productId, userId: uid });
      }
    },
    afterVariantLoopBeforeAssets: async ({ lastProductId, createdColorCount }) => {
      if (!lastProductId || createdColorCount === 0) return;
      await applyLaunchMetadataDefaults({
        db,
        admin,
        sanitizeForFirestore,
        productId: lastProductId,
        blankId,
      });
      await setLaunchStatusGeneratingAssets({
        db,
        admin,
        sanitizeForFirestore,
        productId: lastProductId,
        userId: uid,
      });
    },
  });

  return {
    ...result,
    launchMode: true,
    autoSyncShopify: launchOptions.autoSyncShopify,
  };
}

module.exports = { launchProductsFromDesign };
