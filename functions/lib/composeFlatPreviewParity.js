"use strict";

/**
 * Flat "Product Preview" parity compositor.
 *
 * WHY THIS EXISTS
 * ---------------
 * The editor's live CSS canvas and the legacy `composeStageA` preview diverged from
 * the *actual* product render (`render8394DesignOnGarmentSharp` via
 * `officialProductFlatCompose`) in three ways:
 *   1. crop      — composeStageA used the full padded design PNG; the product crops to
 *                  artwork bounds first, so the artwork fills the box (renders bigger).
 *   2. box base  — composeStageA sized the box at `blankW × safeArea.w × scale`; the
 *                  product sizes at `blankW × artboardBase × scale`.
 *   3. blend     — composeStageA forced clean normal/1.0; the product applies the
 *                  engine blend resolved from the saved profile (and client/server
 *                  blend formulas differ).
 *
 * Rather than patch composeStageA to *mimic* the product in three places (fragile),
 * this renders the flat preview through the **same code the product uses**:
 * `resolveSavedBlankRenderProfile` → `render8394DesignOnGarmentSharp`, with
 * `product = null` (pure blank render profile). The output is byte-for-byte what the
 * generated product will render — scale, position, crop, blend, mask, and warp all
 * come from the one shared resolver/compositor. This is the contract the whole app
 * depends on: "the blank render profile IS what ships."
 *
 * Only the FLAT sync preview routes here. Model targets (quad warp + Flux Fill) and
 * the AI-realism Stage B path keep composeStageA — their inputs and gateway timing
 * are different.
 */

const { render8394DesignOnGarmentSharp, savePngAndReadableUrl } = require("./productFlatRenderMvp");
const { isPipelineReadyStyleCode } = require("./pipelineReadiness");
const { getVariantFlatBackUrl, getVariantFlatFrontUrl } = require("./variantRenderSources");
const { resolveBackRenderTreatment, resolveBlendedPreviewBlend8394 } = require("./artworkToneResolution");
const { getPlacementRowForSide } = require("./resolveProductRenderProfile");
const { resolveSavedBlankRenderProfile } = require("./resolveSavedBlankRenderProfile");
const { getEffectiveColorFamilyForBlankPreview } = require("./designPickForBlankPreview");

function renderTargetToSide(target) {
  return target === "flat_front" || target === "model_front" ? "front" : "back";
}

/**
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {{ bucket: () => any }} args.storage
 * @param {typeof import("sharp")} args.sharp
 * @param {typeof import("firebase-functions")} args.functions
 * @param {{ blankId, variantId, designId, renderTarget }} args.input
 * @returns {Promise<{ stageA: object, variant: object }>} same shape the sync path
 *   consumes from composeStageA.
 */
async function composeFlatPreviewParity({ db, storage, sharp, functions, input }) {
  const { blankId, variantId, designId, renderTarget } = input;
  const side = renderTargetToSide(renderTarget);

  if (renderTarget !== "flat_front" && renderTarget !== "flat_back") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `composeFlatPreviewParity only handles flat targets (got ${renderTarget})`
    );
  }
  if (!variantId) {
    // Parity render is per-color (color matrix lives per variant). Without an explicit
    // color we cannot match the product, so the caller should fall back to composeStageA.
    throw new functions.https.HttpsError(
      "failed-precondition",
      "composeFlatPreviewParity requires an explicit variantId (garment color)"
    );
  }

  const fetchFn = typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  if (!fetchFn) {
    throw new functions.https.HttpsError("internal", "global.fetch is required for flat preview parity");
  }

  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) throw new functions.https.HttpsError("not-found", `Blank ${blankId} not found`);
  const blank = blankSnap.data();

  if (!isPipelineReadyStyleCode(blank.styleCode)) {
    // Non-pipeline blanks never produce products through this compositor; let the
    // caller fall back to composeStageA for a best-effort preview.
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Blank styleCode "${blank.styleCode || "unknown"}" is not pipelineReady`
    );
  }

  const variantRow = (blank.variants || []).find((v) => v && v.variantId === variantId);
  if (!variantRow) {
    throw new functions.https.HttpsError("failed-precondition", `Blank variant ${variantId} not found`);
  }

  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) throw new functions.https.HttpsError("not-found", `Design ${designId} not found`);
  const design = designSnap.data();

  /**
   * product = null → pure blank render profile (placement baseline + per-color matrix +
   * variant slices). Exactly what `officialProductFlatCompose` resolves before a product
   * adds its own (rare) overrides. This is the canonical "what the blank profile produces."
   */
  const savedProfile = resolveSavedBlankRenderProfile({
    blank,
    blankVariantId: variantId,
    design,
    product: null,
    renderTarget,
  });
  if (!savedProfile) {
    throw new functions.https.HttpsError("failed-precondition", "resolveSavedBlankRenderProfile: blank color row missing");
  }

  const sideEffective =
    side === "front" ? savedProfile.printSides.effectiveFront : savedProfile.printSides.effectiveBack;
  if (!sideEffective) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `This blank/design does not allow ${side} artwork (effective${side === "front" ? "Front" : "Back"}=false).`
    );
  }
  if (!savedProfile.placement) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Missing effective placement for ${renderTarget} (${side})`
    );
  }

  const pkResolved =
    (savedProfile.placement.placementId && String(savedProfile.placement.placementId).trim()) ||
    (side === "front" ? "front_center" : "back_center");

  const blankImageUrl =
    savedProfile.garmentImageUrl ||
    (side === "front" ? getVariantFlatFrontUrl(blank, variantRow) : getVariantFlatBackUrl(blank, variantRow));
  if (!blankImageUrl) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `No saved ${side} garment image for this color — add variants[].images.flat${side === "front" ? "Front" : "Back"} on the blank.`
    );
  }

  const designAssetUrl = savedProfile.resolvedDesignUrl;
  if (!designAssetUrl) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Design has no usable ${side} PNG (assets.${side}.lightPng / darkPng / whitePng).`
    );
  }
  const resolvedToneRef = savedProfile.resolvedTone || "dark";

  /** Same tone/treatment + blend pipeline as officialProductFlatCompose. */
  const blankGarmentFam = getEffectiveColorFamilyForBlankPreview(variantRow.colorFamily, variantRow.colorName);
  const renderTreatment = resolveBackRenderTreatment(blankGarmentFam, resolvedToneRef);

  const tuningFlat = savedProfile.tuning;
  let blend = savedProfile.engineBlend;
  if (renderTreatment === "blended") {
    const adj = resolveBlendedPreviewBlend8394(blankGarmentFam, resolvedToneRef, blend);
    blend = { blendMode: adj.blendMode, blendOpacity: adj.blendOpacity };
  }
  const effPl = savedProfile.placement;

  const blankResp = await fetchFn(blankImageUrl);
  if (!blankResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch garment image (HTTP ${blankResp.status})`);
  const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

  const designResp = await fetchFn(designAssetUrl);
  if (!designResp.ok) throw new functions.https.HttpsError("internal", `Failed to fetch design PNG (HTTP ${designResp.status})`);
  const designBuffer = Buffer.from(await designResp.arrayBuffer());

  const placementRowFlat = getPlacementRowForSide(blank, side, pkResolved);
  if (!placementRowFlat) {
    throw new functions.https.HttpsError("failed-precondition", `Blank has no ${side} placement (e.g. ${pkResolved})`);
  }

  const renderSelectionLog = [];
  const { flatCleanBuffer, flatBlendedBuffer, composeTelemetry } = await render8394DesignOnGarmentSharp({
    sharp,
    blankBuffer,
    designBuffer,
    tuning: tuningFlat,
    blend,
    placementRow: placementRowFlat,
    effPl,
    variant: variantRow,
    target: renderTarget,
    renderTreatment,
    renderSelectionLog,
    debugArtifacts: null,
  });

  const outBuf = renderTreatment === "clean" ? flatCleanBuffer : flatBlendedBuffer;
  const meta = await sharp(outBuf).metadata();

  const bucket = storage.bucket();
  const ts = Date.now();
  const storagePath = `rp_blank_previews/${blankId}/${variantId}/${renderTarget}_parity_${ts}.png`;
  const previewUrl = await savePngAndReadableUrl(bucket, storagePath, outBuf);

  console.log(
    `[composeFlatPreviewParity] ${blankId}/${variantId} ${renderTarget} treatment=${renderTreatment} ` +
      `scale=${tuningFlat.settings.placement.scale} blend=${blend.blendMode}/${blend.blendOpacity} ` +
      `tuningLayer=${tuningFlat.qa ? tuningFlat.qa.primaryTuningLayer : "?"}`
  );

  /** Shape mirrors composeStageA's `stageA` so the callable's return is unchanged. */
  const stageA = {
    previewUrl,
    storagePath,
    width: meta.width || null,
    height: meta.height || null,
    bytes: outBuf.length,
    maskApplied: !!(tuningFlat.settings.mask && tuningFlat.settings.mask.enabled),
    maskMean: null,
    maskMode: tuningFlat.settings.mask && tuningFlat.settings.mask.enabled ? "blank_mask_doc" : null,
    quadWarpApplied: false,
    garmentClipApplied: false,
    placementUsed: {
      x: tuningFlat.settings.placement.x,
      y: tuningFlat.settings.placement.y,
      scale: tuningFlat.settings.placement.scale,
      blendMode: blend.blendMode,
      blendOpacity: blend.blendOpacity,
    },
    parityPath: "official_product_compositor",
    renderTreatment,
    composeTelemetry: composeTelemetry || null,
  };

  return { stageA, variant: variantRow };
}

module.exports = { composeFlatPreviewParity };
