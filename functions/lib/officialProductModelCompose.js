"use strict";

/**
 * Deterministic 8394 on-model catalog roles from saved blank model images + `resolveSavedBlankRenderProfile`
 * (no rp_identities / LoRA). Parallel to `officialProductFlatCompose`.
 */

const { render8394DesignOnGarmentSharp, savePngAndReadableUrl } = require("./productFlatRenderMvp");
const { getVariantModelBackUrl, getVariantModelFrontUrl } = require("./variantRenderSources");
const { resolveBackRenderTreatment, resolveBlendedPreviewBlend8394 } = require("./artworkToneResolution");
const { getPlacementRowForSide } = require("./resolveProductRenderProfile");
const { resolveSavedBlankRenderProfile } = require("./resolveSavedBlankRenderProfile");
const { getEffectiveColorFamilyForBlankPreview } = require("./designPickForBlankPreview");
const { mergePlacementSource } = require("./officialProductFlatCompose");

function modelRenderLog(tag, payload) {
  try {
    console.log(`[${tag}]\n${JSON.stringify(payload, null, 2)}`);
  } catch {
    console.log(`[${tag}]`, payload);
  }
}

/**
 * @param {object} ctx
 * @param {"model_back_designed"|"model_front_clean"} ctx.role
 */
async function composeOfficial8394ModelRole(ctx) {
  const { db, admin, storage, productId, primaryVariantId, blankVariantId, role, batchId, userId } = ctx;

  const fetchFn = typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  if (!fetchFn) {
    throw new Error("global.fetch is required for official model composition");
  }

  const sharp = require("sharp");

  if (role !== "model_back_designed" && role !== "model_front_clean") {
    throw new Error(`composeOfficial8394ModelRole: unsupported role ${role}`);
  }

  const renderTarget = role === "model_back_designed" ? "model_back" : "model_front";
  const side = renderTarget === "model_front" ? "front" : "back";

  const productRef = db.collection("rp_products").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) throw new Error("Product not found");
  const product = productSnap.data();

  const variantRef = productRef.collection("variants").doc(primaryVariantId);
  const variantSnap = await variantRef.get();
  if (!variantSnap.exists) throw new Error("Variant not found");
  const variantDoc = variantSnap.data();

  const blankId = product.blankId;
  if (!blankId) throw new Error("Product missing blankId");

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) throw new Error("Blank not found");
  const blank = blankSnap.data();

  if (String(blank.styleCode || "").trim() !== "8394") {
    throw new Error("Official model composition supports 8394 blanks only");
  }

  const variantRow = (blank.variants || []).find((v) => v.variantId === blankVariantId);
  if (!variantRow) throw new Error("Blank variant row not found");

  const placementProduct = mergePlacementSource(product, variantDoc);
  const rsSide = variantDoc.renderSetup && variantDoc.renderSetup[side] ? variantDoc.renderSetup[side] : {};

  const designId =
    (variantDoc.designId && String(variantDoc.designId).trim()) ||
    (product.designId && String(product.designId).trim()) ||
    (variantDoc.designIdBack && String(variantDoc.designIdBack).trim()) ||
    (product.designIdBack && String(product.designIdBack).trim()) ||
    (variantDoc.designIdFront && String(variantDoc.designIdFront).trim()) ||
    (product.designIdFront && String(product.designIdFront).trim()) ||
    null;

  if (!designId) throw new Error("Missing designId on product/variant for model composition");

  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) throw new Error(`Design ${designId} not found`);
  const design = designSnap.data();

  const savedProfile = resolveSavedBlankRenderProfile({
    blank,
    blankVariantId,
    design,
    product: placementProduct,
    renderTarget,
  });
  if (!savedProfile) {
    throw new Error("resolveSavedBlankRenderProfile: blank color row missing");
  }

  modelRenderLog("RESOLVED_SAVED_BLANK_RENDER_PROFILE_MODEL", {
    productId,
    blankVariantId,
    primaryVariantId,
    role,
    source: savedProfile.source,
    printSides: savedProfile.printSides,
    garmentImageUrl: savedProfile.garmentImageUrl,
    resolvedDesignUrl: savedProfile.resolvedDesignUrl,
    resolvedTone: savedProfile.resolvedTone,
    sourcePathUsed: savedProfile.sourcePathUsed,
    placementId: savedProfile.placement && savedProfile.placement.placementId,
    tuningLayer: savedProfile.tuning && savedProfile.tuning.qa ? savedProfile.tuning.qa.primaryTuningLayer : null,
    sideAllowedForDesign: savedProfile.sideAllowedForDesign,
  });

  const pkResolved =
    (savedProfile.placement && savedProfile.placement.placementId && String(savedProfile.placement.placementId).trim()) ||
    (side === "front" ? "front_center" : "back_center");

  const blankImageUrl =
    savedProfile.garmentImageUrl ||
    (rsSide.blankImageUrl && String(rsSide.blankImageUrl).trim()) ||
    (side === "front" ? getVariantModelFrontUrl(blank, variantRow) : getVariantModelBackUrl(blank, variantRow));

  if (!savedProfile.garmentImageUrl && blankImageUrl) {
    modelRenderLog("EMERGENCY_FALLBACK_GARMENT_IMAGE_MODEL", {
      productId,
      primaryVariantId,
      blankVariantId,
      role,
      side,
      message:
        "Saved blank profile had no model garmentImageUrl; used variant.renderSetup or legacy blank variant images.",
    });
  }
  if (!blankImageUrl) {
    throw new Error(
      `Missing on-model garment image for ${side}: save modelFront/modelBack on the master blank color row for this variant.`
    );
  }

  /**
   * `model_front_clean` garment-only when commerce/blank recipe does not place front artwork on the model.
   */
  if (role === "model_front_clean" && !savedProfile.sideAllowedForDesign) {
    const blankResp = await fetchFn(blankImageUrl);
    if (!blankResp.ok) {
      throw new Error(`Failed to fetch model image: HTTP ${blankResp.status}`);
    }
    const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

    const bucket = storage.bucket();
    const ts = Date.now();
    const storagePath = `rp_products/${productId}/variants/${primaryVariantId}/official_model/${batchId}_${role}_${ts}.png`;
    const imageUrl = await savePngAndReadableUrl(bucket, storagePath, blankBuffer);

    const provenance = {
      resolvedFromBlankId: String(blank.blankId || "").trim(),
      resolvedFromBlankVariantId: String(blankVariantId || "").trim(),
      resolvedRenderTarget: renderTarget,
      resolvedPlacementId: String(pkResolved || ""),
      resolvedTone: null,
      resolvedDesignUrl: null,
      sourcePathUsed: null,
      resolvedGarmentImageUrl: blankImageUrl || null,
      compositionSource: "blank_native",
      garmentOnlyCleanFront: true,
      garmentOnly: true,
      renderPath: "garment_only_model_front_clean",
      blankRenderProfileVersion: typeof blank.version === "number" ? blank.version : null,
      blankDocUpdatedAt: blank.updatedAt || null,
      tuningLayer: null,
      recipeProvenanceSchemaVersion: 1,
    };

    return { imageUrl, storagePath, resolvedToneRef: null, provenance };
  }

  if (role === "model_back_designed" && !savedProfile.printSides.effectiveBack) {
    throw new Error(
      `Saved blank profile + design do not allow back artwork (effectiveBack=false). Adjust blank/design or supportedRenderViews.`
    );
  }
  if (role === "model_front_clean" && savedProfile.sideAllowedForDesign && !savedProfile.placement) {
    throw new Error(`resolveSavedBlankRenderProfile: missing effective placement for ${renderTarget} (${side})`);
  }
  if (role === "model_back_designed" && !savedProfile.placement) {
    throw new Error(`resolveSavedBlankRenderProfile: missing effective placement for ${renderTarget} (${side})`);
  }

  const designAssetUrl = savedProfile.resolvedDesignUrl;
  const resolvedToneRef = savedProfile.resolvedTone || "dark";
  const sourcePathUsed = savedProfile.sourcePathUsed;

  if (!designAssetUrl) {
    throw new Error(
      "Design missing usable PNG for this model role: expected nested assets/files for the print side, same as the blank render profile editor."
    );
  }

  const placementRowModel = getPlacementRowForSide(blank, side, pkResolved);
  if (!placementRowModel) {
    throw new Error(`Blank has no ${side} placement (e.g. ${pkResolved})`);
  }

  const blankGarmentFam = getEffectiveColorFamilyForBlankPreview(variantRow.colorFamily, variantRow.colorName);
  const renderTreatment = resolveBackRenderTreatment(blankGarmentFam, resolvedToneRef);

  const tuningModel = savedProfile.tuning;
  let blend = savedProfile.engineBlend;
  if (renderTreatment === "blended") {
    const adj = resolveBlendedPreviewBlend8394(blankGarmentFam, resolvedToneRef, blend);
    blend = { blendMode: adj.blendMode, blendOpacity: adj.blendOpacity };
    modelRenderLog("8394_PREVIEW_OFFICIAL_BLEND_PARITY", {
      productId,
      blankVariantId,
      renderTarget,
      baseEngineBlend: savedProfile.engineBlend,
      adjustedBlend: blend,
      garmentFamily: blankGarmentFam,
      resolvedTone: resolvedToneRef,
    });
  }
  const effPl = savedProfile.placement;

  const blankResp = await fetchFn(blankImageUrl);
  if (!blankResp.ok) {
    throw new Error(`Failed to fetch model garment image: HTTP ${blankResp.status}`);
  }
  const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

  const designResp = await fetchFn(designAssetUrl);
  if (!designResp.ok) {
    throw new Error(`Failed to fetch design PNG: HTTP ${designResp.status}`);
  }
  const designBufferRaw = Buffer.from(await designResp.arrayBuffer());

  const renderSelectionLog = [];

  const { flatCleanBuffer, flatBlendedBuffer } = await render8394DesignOnGarmentSharp({
    sharp,
    blankBuffer,
    designBuffer: designBufferRaw,
    tuning: tuningModel,
    blend,
    placementRow: placementRowModel,
    effPl,
    variant: variantRow,
    target: renderTarget,
    renderTreatment,
    renderSelectionLog,
  });

  const outBuf = renderTreatment === "clean" ? flatCleanBuffer : flatBlendedBuffer;

  const bucket = storage.bucket();
  const ts = Date.now();
  const storagePath = `rp_products/${productId}/variants/${primaryVariantId}/official_model/${batchId}_${role}_${ts}.png`;
  const imageUrl = await savePngAndReadableUrl(bucket, storagePath, outBuf);

  modelRenderLog("MODEL_RENDER:SUCCESS", {
    productId,
    batchId,
    role,
    blankImageUrl,
    designAssetUrl,
    placementKey: pkResolved,
    storagePath,
    imageUrl,
    userId: userId || null,
  });

  const provenance = {
    resolvedFromBlankId: String(blank.blankId || "").trim(),
    resolvedFromBlankVariantId: String(blankVariantId || "").trim(),
    resolvedRenderTarget: renderTarget,
    resolvedPlacementId: String(pkResolved || ""),
    resolvedTone: resolvedToneRef || null,
    resolvedDesignUrl: designAssetUrl || null,
    sourcePathUsed: sourcePathUsed != null ? String(sourcePathUsed) : null,
    resolvedGarmentImageUrl: blankImageUrl || null,
    compositionSource: "blank_native",
    garmentOnlyCleanFront: false,
    garmentOnly: false,
    renderPath: "design_composite_8394_model",
    blankRenderProfileVersion: typeof blank.version === "number" ? blank.version : null,
    blankDocUpdatedAt: blank.updatedAt || null,
    tuningLayer:
      savedProfile.tuning && savedProfile.tuning.qa && savedProfile.tuning.qa.primaryTuningLayer
        ? savedProfile.tuning.qa.primaryTuningLayer
        : null,
    recipeProvenanceSchemaVersion: 1,
  };

  return { imageUrl, storagePath, resolvedToneRef, provenance };
}

module.exports = {
  composeOfficial8394ModelRole,
};
