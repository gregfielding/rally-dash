"use strict";

const { resolvePrintSidesForProductBuild } = require("./resolveDefaultPrintSides");
const { PIPELINE_STAGE, pipelineFailurePatch } = require("./pipelineReporting");

function pickPrintFileRefs8394(v) {
  const fr = v.flatRenders || {};
  return {
    flat_clean_front: fr.flat_clean?.front?.url || null,
    flat_blended_back: fr.flat_blended?.back?.url || null,
    model_clean_front: fr.model_clean?.front?.url || null,
    model_blended_back: fr.model_blended?.back?.url || null,
    heroFront: v.media?.heroFront || null,
    heroBack: v.media?.heroBack || null,
    mockupUrl: v.mockupUrl || null,
  };
}

function variantFulfillmentMissing(v, blankStyleCode) {
  const missing = [];
  if (!String(v.sku || "").trim()) missing.push("sku");
  const opt = v.optionValues || {};
  if (!String(opt.color || "").trim() && !String(v.colorName || "").trim()) missing.push("color");
  if (!String(opt.size || "").trim()) missing.push("size");
  const is8394 = String(blankStyleCode || "").trim() === "8394";
  const refs = pickPrintFileRefs8394(v);
  const hasAnyImage = !!(refs.heroBack || refs.heroFront || refs.mockupUrl || refs.flat_blended_back);
  if (is8394 && !hasAnyImage) missing.push("variant_image_or_flat");
  return missing;
}

/**
 * Persist structured fulfillment snapshot on parent + variant subdocs.
 */
async function buildFulfillmentPackage(ctx) {
  const { db, admin, sanitizeForFirestore, productId } = ctx;
  const productRef = db.collection("rp_products").doc(productId);
  const [pSnap, vSnap] = await Promise.all([
    productRef.get(),
    productRef.collection("variants").get(),
  ]);
  if (!pSnap.exists) return { ok: false, reason: "no_product" };
  const product = pSnap.data() || {};
  const blankId = product.blankId;
  const designId = product.designId;
  const parentMissing = [];
  if (!blankId || !designId) {
    parentMissing.push("blankId_or_designId");
    await productRef.set(
      sanitizeForFirestore({
        fulfillmentSummary: {
          version: 1,
          fulfillmentReady: false,
          fulfillmentMissing: parentMissing,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        ...pipelineFailurePatch(
          admin,
          "Fulfillment: missing blankId or designId on product document",
          PIPELINE_STAGE.FULFILLMENT
        ),
      }),
      { merge: true }
    );
    return { ok: false, reason: "missing_design_or_blank" };
  }

  const [bSnap, dSnap] = await Promise.all([
    db.collection("rp_blanks").doc(blankId).get(),
    db.collection("designs").doc(designId).get(),
  ]);
  const blank = bSnap.exists ? bSnap.data() || {} : {};
  const design = dSnap.exists ? dSnap.data() || {} : {};
  const blankStyleCode = String(product.blankStyleCode || blank.styleCode || "").trim();

  const sideRes = resolvePrintSidesForProductBuild(blank, design);
  const printSides = {
    blankMode: sideRes.blankMode,
    designMode: sideRes.designMode,
    effectiveFront: sideRes.effectiveFront,
    effectiveBack: sideRes.effectiveBack,
    primaryPlacementSide: sideRes.primaryPlacementSide,
    canGenerate: sideRes.canGenerate,
  };

  const sizesOffered = Array.isArray(product.availableSizes) ? [...product.availableSizes] : [];
  if (sizesOffered.length === 0) parentMissing.push("sizes_offered");

  const colorLines = new Map();
  for (const d of vSnap.docs) {
    const v = d.data() || {};
    const bk = v.blankVariantId && String(v.blankVariantId).trim() ? String(v.blankVariantId).trim() : null;
    if (!bk) continue;
    if (!colorLines.has(bk)) {
      colorLines.set(bk, {
        blankVariantId: bk,
        colorName: v.colorName || (v.optionValues && v.optionValues.color) || null,
        variantDocCount: 0,
      });
    }
    colorLines.get(bk).variantDocCount += 1;
  }

  const variantPayloads = [];
  let allVariantsReady = true;
  for (const d of vSnap.docs) {
    const v = d.data() || {};
    const vm = variantFulfillmentMissing(v, blankStyleCode);
    if (vm.length > 0) allVariantsReady = false;
    variantPayloads.push({
      ref: d.ref,
      pkg: {
        version: 1,
        blankId,
        blankVariantId: v.blankVariantId || null,
        designId,
        designIdFront: v.designIdFront || null,
        designIdBack: v.designIdBack || null,
        colorName: v.colorName || null,
        optionValues: v.optionValues || {},
        sku: v.sku || null,
        preferredArtworkTone: v.preferredArtworkTone || null,
        printSides,
        printFileRefs: pickPrintFileRefs8394(v),
        renderSetup: v.renderSetup || null,
        placementOverrides: v.placementOverrides || null,
        renderOverrides: v.renderOverrides || null,
        fulfillmentReady: vm.length === 0,
        fulfillmentMissing: vm,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  const fulfillmentSummary = {
    version: 1,
    blankId,
    designId,
    teamId: product.teamId || null,
    blankStyleCode: blankStyleCode || null,
    printSides,
    artworkToneNotes: design ? String(design.designType || "") : null,
    sizesOffered,
    colorLines: [...colorLines.values()],
    variantCount: vSnap.size,
    fulfillmentReady: allVariantsReady && parentMissing.length === 0,
    fulfillmentMissing: parentMissing,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const chunkSize = 400;
  for (let i = 0; i < variantPayloads.length; i += chunkSize) {
    const chunk = variantPayloads.slice(i, i + chunkSize);
    const b = db.batch();
    for (const { ref, pkg } of chunk) {
      b.set(ref, sanitizeForFirestore({ fulfillmentPackage: pkg }), { merge: true });
    }
    if (i + chunkSize >= variantPayloads.length) {
      b.set(
        productRef,
        sanitizeForFirestore({
          fulfillmentSummary,
        }),
        { merge: true }
      );
    }
    await b.commit();
  }

  if (variantPayloads.length === 0) {
    await productRef.set(sanitizeForFirestore({ fulfillmentSummary }), { merge: true });
  }

  return { ok: true, fulfillmentSummary };
}

module.exports = { buildFulfillmentPackage, variantFulfillmentMissing };
