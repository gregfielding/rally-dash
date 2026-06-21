"use strict";

const crypto = require("crypto");

function sha256HexBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Deterministic 8394 flat catalog roles (no rp_scene_presets, no generation jobs).
 * `flat_back_designed`: same inputs as `generateProductFlatRenders` back path — `pickDesignPngForVariant` +
 *   `resolveEffectiveRenderTargetSettings` + `render8394DesignOnGarmentSharp` (blank render profile / color matrix).
 * `flat_front_clean`: garment pass-through only (same as MVP `flat_clean_front` — raw master image bytes, no artwork).
 */

const { render8394DesignOnGarmentSharp, savePngAndReadableUrl } = require("./productFlatRenderMvp");
const { isPipelineReadyStyleCode } = require("./pipelineReadiness");
const { getVariantFlatBackUrl, getVariantFlatFrontUrl } = require("./variantRenderSources");
const { resolveBackRenderTreatment, resolveBlendedPreviewBlend8394 } = require("./artworkToneResolution");
const { getPlacementRowForSide } = require("./resolveProductRenderProfile");
const { resolveSavedBlankRenderProfile } = require("./resolveSavedBlankRenderProfile");
const { getEffectiveColorFamilyForBlankPreview } = require("./designPickForBlankPreview");

function mergePlacementSource(parent, variantDoc) {
  if (!variantDoc || typeof variantDoc !== "object") return parent;
  return {
    ...parent,
    renderSetup: variantDoc.renderSetup || parent.renderSetup,
    placementOverrides: variantDoc.placementOverrides != null ? variantDoc.placementOverrides : parent.placementOverrides,
    renderOverrides: variantDoc.renderOverrides != null ? variantDoc.renderOverrides : parent.renderOverrides,
  };
}

function flatRenderLog(tag, payload) {
  try {
    console.log(`[${tag}]\n${JSON.stringify(payload, null, 2)}`);
  } catch {
    console.log(`[${tag}]`, payload);
  }
}

/**
 * @param {object} ctx
 * @param {FirebaseFirestore.Firestore} ctx.db
 * @param {typeof import("firebase-admin")} ctx.admin
 * @param {import("@google-cloud/storage").Bucket} ctx.storage
 * @param {string} ctx.productId
 * @param {string} ctx.primaryVariantId
 * @param {string} ctx.blankVariantId
 * @param {"flat_front_clean"|"flat_back_designed"} ctx.role
 * @param {string} ctx.batchId
 * @param {string} ctx.userId
 * @returns {Promise<{ imageUrl: string, storagePath: string, resolvedToneRef: string | null }>}
 */
async function composeOfficial8394FlatRole(ctx) {
  const { db, admin, storage, productId, primaryVariantId, blankVariantId, role, batchId, userId } = ctx;

  const fetchFn = typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  if (!fetchFn) {
    throw new Error("global.fetch is required for official flat composition");
  }

  const sharp = require("sharp");

  /**
   * Role → (render target, designed?). flat_front_designed (front-print apparel)
   * runs the SAME designed compose path as flat_back_designed, just side=front.
   * flat_front_clean stays garment-only.
   */
  const ROLE_CFG = {
    flat_front_clean: { renderTarget: "flat_front", designed: false },
    flat_front_designed: { renderTarget: "flat_front", designed: true },
    flat_back_designed: { renderTarget: "flat_back", designed: true },
  };
  const roleCfg = ROLE_CFG[role];
  if (!roleCfg) {
    throw new Error(`composeOfficial8394FlatRole: unsupported role ${role}`);
  }
  const renderTarget = roleCfg.renderTarget;
  const side = renderTarget === "flat_front" ? "front" : "back";
  const isDesignedRole = roleCfg.designed;

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

  /**
   * Gate by the pipeline-readiness registry instead of a hardcoded 8394 check.
   * Function name retains "8394" historically — the underlying sharp pipeline
   * (placement + warp + mask + blend) is generic; only the per-render config
   * `warp.enabled` / `mask.enabled` knobs in each blank's render profile decide
   * whether those steps actually run for a given blank/variant.
   */
  if (!isPipelineReadyStyleCode(blank.styleCode)) {
    throw new Error(
      `Official flat composition: blank styleCode "${blank.styleCode || "unknown"}" is not pipelineReady (see functions/lib/pipelineReadiness.js)`
    );
  }

  const variantRow = (blank.variants || []).find((v) => v.variantId === blankVariantId);
  if (!variantRow) throw new Error("Blank variant row not found");

  const placementProduct = mergePlacementSource(product, variantDoc);
  const rsSide = variantDoc.renderSetup && variantDoc.renderSetup[side] ? variantDoc.renderSetup[side] : {};

  /** One design doc per product; optional per-side ids reserved for future split artwork. */
  const designId =
    (variantDoc.designId && String(variantDoc.designId).trim()) ||
    (product.designId && String(product.designId).trim()) ||
    (variantDoc.designIdBack && String(variantDoc.designIdBack).trim()) ||
    (product.designIdBack && String(product.designIdBack).trim()) ||
    (variantDoc.designIdFront && String(variantDoc.designIdFront).trim()) ||
    (product.designIdFront && String(product.designIdFront).trim()) ||
    null;

  if (!designId) throw new Error("Missing designId on product/variant for tone-based artwork");

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
  if (isDesignedRole) {
    const sideEffective =
      side === "front" ? savedProfile.printSides.effectiveFront : savedProfile.printSides.effectiveBack;
    if (!sideEffective) {
      throw new Error(
        `Saved blank profile + design do not allow ${side} artwork (effective${side === "front" ? "Front" : "Back"}=false). Adjust blank/design or supportedRenderViews.`
      );
    }
    if (!savedProfile.placement) {
      throw new Error(`resolveSavedBlankRenderProfile: missing effective placement for ${renderTarget} (${side})`);
    }
  }
  /** `flat_front_clean` is garment-only; allowed even when commerce print is back-only (supplemental PDP asset). */
  if (role === "flat_front_clean" && !savedProfile.printSides.effectiveFront && !savedProfile.garmentImageUrl) {
    throw new Error(
      `No saved front garment image for this color: add variants[].images.flatFront on ${savedProfile.source.blankDocPath} (or legacy front slot).`
    );
  }

  flatRenderLog("RESOLVED_SAVED_BLANK_RENDER_PROFILE", {
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
    (side === "front" ? getVariantFlatFrontUrl(blank, variantRow) : getVariantFlatBackUrl(blank, variantRow));
  if (!savedProfile.garmentImageUrl && blankImageUrl) {
    flatRenderLog("EMERGENCY_FALLBACK_GARMENT_IMAGE", {
      productId,
      primaryVariantId,
      blankVariantId,
      role,
      side,
      message:
        "Saved blank profile had no garmentImageUrl; used variant.renderSetup or legacy blank variant images. Fix master blank color row URLs.",
    });
  }
  if (!blankImageUrl) {
    throw new Error(
      `Missing garment image for ${side}: save flat/model URLs on the master blank color (rp_blanks … variants[].images), or set variant.renderSetup.${side}.blankImageUrl as a fallback`
    );
  }

  /**
   * Official `flat_front_clean` is **garment raster only** (no design fetch, no Sharp composite).
   * Back-only blanks still emit a supplemental clean-front PNG for thumbs/secondary slots — never artwork on the front.
   */
  if (role === "flat_front_clean") {
    const blankResp = await fetchFn(blankImageUrl);
    if (!blankResp.ok) {
      throw new Error(`Failed to fetch blank image: HTTP ${blankResp.status}`);
    }
    /** Match MVP `flat_clean_front`: upload fetched bytes as-is (no Sharp round-trip — keeps parity with master asset). */
    const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

    const bucket = storage.bucket();
    const ts = Date.now();
    const storagePath = `rp_products/${productId}/variants/${primaryVariantId}/official_flat/${batchId}_${role}_${ts}.png`;
    const imageUrl = await savePngAndReadableUrl(bucket, storagePath, blankBuffer);

    flatRenderLog("FLAT_RENDER:GARMENT_ONLY_FRONT", {
      productId,
      batchId,
      role,
      blankImageUrl,
      placementKey: pkResolved,
      storagePath,
      imageUrl,
      printSides: savedProfile.printSides,
      userId: userId || null,
    });

    flatRenderLog("OFFICIAL_FLAT_REGRESSION:back_only_checks", {
      productId,
      primaryVariantId,
      blankVariantId,
      role,
      expect: "flat_front_clean has no resolvedDesignUrl; storefront primary for back_only stays flat_back / heroBack",
      printSides: savedProfile.printSides,
      garmentOnlyCleanFront: true,
    });

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
      renderPath: "garment_only_clean_front",
      blankRenderProfileVersion: typeof blank.version === "number" ? blank.version : null,
      blankDocUpdatedAt: blank.updatedAt || null,
      tuningLayer: null,
      recipeProvenanceSchemaVersion: 1,
    };

    return { imageUrl, storagePath, resolvedToneRef: null, provenance };
  }

  /**
   * Official flat back compositing always fetches design bytes from `savedProfile.resolvedDesignUrl`
   * (deterministic tone + `files.*.downloadUrl` chain). Never `variant.renderSetup.back.designAssetUrl`.
   */
  const designAssetUrl = savedProfile.resolvedDesignUrl;
  const resolvedToneRef = savedProfile.resolvedTone || "dark";
  const sourcePathUsed = savedProfile.sourcePathUsed;

  flatRenderLog("DESIGN_TONE_RESOLUTION", {
    designId,
    blankId,
    variantId: primaryVariantId,
    side,
    toneRule: savedProfile.toneRule,
    resolvedTone: resolvedToneRef,
    resolvedDesignUrl: designAssetUrl || null,
    sourcePathUsed,
    designPick: "resolveSavedBlankRenderProfile_pickDesignPngUrlForBlankPreview",
  });

  if (!designAssetUrl) {
    throw new Error(
      "Design missing usable back PNG for 8394: expected assets.back.lightPng / darkPng / whitePng (or files.back.*), same as generateProductFlatRenders and the blank render profile editor."
    );
  }

  flatRenderLog("FLAT_RENDER:START", {
    productId,
    batchId,
    role,
    blankVariantId,
    primaryVariantId,
    blankImageUrl,
    designAssetUrl,
    placementKey: pkResolved,
  });

  const placementRowFlat = getPlacementRowForSide(blank, side, pkResolved);
  if (!placementRowFlat) {
    throw new Error(`Blank has no ${side} placement (e.g. ${pkResolved})`);
  }

  const blankGarmentFam = getEffectiveColorFamilyForBlankPreview(variantRow.colorFamily, variantRow.colorName);
  const renderTreatment = resolveBackRenderTreatment(blankGarmentFam, resolvedToneRef);

  const tuningFlat = savedProfile.tuning;
  let blend = savedProfile.engineBlend;
  if (renderTreatment === "blended") {
    const adj = resolveBlendedPreviewBlend8394(blankGarmentFam, resolvedToneRef, blend);
    blend = { blendMode: adj.blendMode, blendOpacity: adj.blendOpacity };
    flatRenderLog("8394_PREVIEW_OFFICIAL_BLEND_PARITY", {
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
    throw new Error(`Failed to fetch blank image: HTTP ${blankResp.status}`);
  }
  const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

  const designResp = await fetchFn(designAssetUrl);
  if (!designResp.ok) {
    throw new Error(`Failed to fetch design PNG: HTTP ${designResp.status}`);
  }
  const designBufferRaw = Buffer.from(await designResp.arrayBuffer());
  const designSha256Hex = sha256HexBuffer(designBufferRaw);
  const designMeta = await sharp(designBufferRaw).metadata();

  flatRenderLog("OFFICIAL_FLAT_DESIGN_SOURCE_PROOF", {
    composeUsesResolvedUrlOnly: true,
    designFetchUrl: designAssetUrl,
    renderSetupSideDesignAssetUrl: rsSide.designAssetUrl ? String(rsSide.designAssetUrl) : null,
    urlsMatch: String(designAssetUrl || "") === String(rsSide.designAssetUrl || ""),
  });

  flatRenderLog("OFFICIAL_FLAT_BACK_BYTE_PROOF_INPUT", {
    productId,
    batchId,
    role,
    resolvedDesignUrl: designAssetUrl,
    designSha256Hex,
    designPixelWidth: designMeta.width ?? null,
    designPixelHeight: designMeta.height ?? null,
    designBytes: designBufferRaw.length,
  });

  const renderSelectionLog = [];

  const debugOfficialFlat =
    process.env.OFFICIAL_FLAT_DEBUG_ARTIFACTS === "1" || process.env.OFFICIAL_FLAT_DEBUG_ARTIFACTS === "true";
  const composeTs = Date.now();
  const bucket = storage.bucket();
  const debugPathPrefix = debugOfficialFlat
    ? `rp_products/${productId}/variants/${primaryVariantId}/official_flat_debug/${batchId}_${role}_${composeTs}`
    : null;

  const {
    flatCleanBuffer,
    flatBlendedBuffer,
    composeTelemetry,
    debugArtifactUrls,
  } = await render8394DesignOnGarmentSharp({
    sharp,
    blankBuffer,
    designBuffer: designBufferRaw,
    tuning: tuningFlat,
    blend,
    placementRow: placementRowFlat,
    effPl,
    variant: variantRow,
    target: renderTarget,
    renderTreatment,
    renderSelectionLog,
    debugArtifacts: debugOfficialFlat && debugPathPrefix ? { bucket, pathPrefix: debugPathPrefix } : null,
  });

  flatRenderLog("OFFICIAL_FLAT_COMPOSE_TELEMETRY", {
    productId,
    batchId,
    role,
    blankVariantId,
    primaryVariantId,
    renderTarget,
    composeTelemetry,
    debugArtifactUrls,
  });

  const outBuf = renderTreatment === "clean" ? flatCleanBuffer : flatBlendedBuffer;
  const outputSha256Hex = sha256HexBuffer(outBuf);
  const outputMeta = await sharp(outBuf).metadata();

  const ts = Date.now();
  const storagePath = `rp_products/${productId}/variants/${primaryVariantId}/official_flat/${batchId}_${role}_${ts}.png`;
  const imageUrl = await savePngAndReadableUrl(bucket, storagePath, outBuf);

  flatRenderLog("OFFICIAL_FLAT_BACK_BYTE_PROOF_OUTPUT", {
    productId,
    batchId,
    role,
    outputSha256Hex,
    outputPixelWidth: outputMeta.width ?? null,
    outputPixelHeight: outputMeta.height ?? null,
    outputBytes: outBuf.length,
    finalOfficialOutputUrl: imageUrl,
    storagePath,
    debugArtifactUrls: debugArtifactUrls || null,
  });

  flatRenderLog("FLAT_RENDER:SUCCESS", {
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

  const composeBytesProof = {
    designFetchUrl: designAssetUrl || null,
    designSha256Hex,
    designPixelWidth: designMeta.width ?? null,
    designPixelHeight: designMeta.height ?? null,
    outputSha256Hex,
    outputPixelWidth: outputMeta.width ?? null,
    outputPixelHeight: outputMeta.height ?? null,
    finalOfficialOutputUrl: imageUrl || null,
    debugArtifactUrls: debugArtifactUrls || null,
  };

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
    renderPath: "design_composite_8394",
    blankRenderProfileVersion: typeof blank.version === "number" ? blank.version : null,
    blankDocUpdatedAt: blank.updatedAt || null,
    tuningLayer:
      savedProfile.tuning && savedProfile.tuning.qa && savedProfile.tuning.qa.primaryTuningLayer
        ? savedProfile.tuning.qa.primaryTuningLayer
        : null,
    recipeProvenanceSchemaVersion: 1,
    composeBytesProof,
  };

  return { imageUrl, storagePath, resolvedToneRef, provenance };
}

module.exports = {
  composeOfficial8394FlatRole,
  mergePlacementSource,
};
