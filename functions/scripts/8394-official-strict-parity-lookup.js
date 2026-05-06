#!/usr/bin/env node
/**
 * Print composeTelemetry.official8394StrictParity for flat_back + model_back (same inputs as
 * 8394-visible-center-matrix-real-proof.js). Use to compare with [PREVIEW8394_STRICT_PARITY] in the browser.
 *
 *   cd functions && node scripts/8394-official-strict-parity-lookup.js --productId=... --variantId=...
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const sharp = require("sharp");

const { resolveSavedBlankRenderProfile, findBlankVariantById } = require("../lib/resolveSavedBlankRenderProfile");
const { getPlacementRowForSide } = require("../lib/resolveProductRenderProfile");
const { resolveBackRenderTreatment, resolveBlendedPreviewBlend8394 } = require("../lib/artworkToneResolution");
const { getEffectiveColorFamilyForBlankPreview } = require("../lib/designPickForBlankPreview");
const { render8394DesignOnGarmentSharp } = require("../lib/productFlatRenderMvp");

const ART_BASE = 0.5;

function buildLayoutPlacement(effPl, placementRow, tuning) {
  if (effPl && placementRow) {
    return {
      ...placementRow,
      defaultX: tuning.settings.placement.x,
      defaultY: tuning.settings.placement.y,
      defaultScale: tuning.settings.placement.scale,
      safeArea: effPl.safeArea,
      artboardBase:
        effPl.artboardBase != null && Number.isFinite(Number(effPl.artboardBase))
          ? Number(effPl.artboardBase)
          : placementRow.artboardBase != null && Number.isFinite(Number(placementRow.artboardBase))
            ? Number(placementRow.artboardBase)
            : ART_BASE,
    };
  }
  return placementRow;
}

function mergePlacementSource(parent, variantDoc) {
  if (!variantDoc || typeof variantDoc !== "object") return parent;
  return {
    ...parent,
    renderSetup: variantDoc.renderSetup || parent.renderSetup,
    placementOverrides: variantDoc.placementOverrides != null ? variantDoc.placementOverrides : parent.placementOverrides,
    renderOverrides: variantDoc.renderOverrides != null ? variantDoc.renderOverrides : parent.renderOverrides,
  };
}

function tuningWithWarpEnabled(base, enabled) {
  const w = base.settings.warp || {};
  return {
    ...base,
    settings: {
      ...base.settings,
      warp: { ...w, enabled: enabled === true },
    },
  };
}

function tryProjectIdFromServiceAccountJson() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p || typeof p !== "string") return null;
  try {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) return null;
    const j = JSON.parse(fs.readFileSync(abs, "utf8"));
    return j.project_id ? String(j.project_id) : null;
  } catch {
    return null;
  }
}

function resolveProjectIdForInit() {
  const fromEnv =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    null;
  if (fromEnv) return fromEnv.trim();
  const fromJson = tryProjectIdFromServiceAccountJson();
  if (fromJson) return fromJson;
  try {
    const fp = path.join(__dirname, "..", "..", ".firebaserc");
    if (fs.existsSync(fp)) {
      const j = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (j.projects && j.projects.default) return String(j.projects.default);
    }
  } catch {
    /* ignore */
  }
  return null;
}

const _pid = resolveProjectIdForInit();
if (!admin.apps.length) {
  if (_pid) admin.initializeApp({ projectId: _pid });
  else admin.initializeApp();
}

const db = admin.firestore();

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function runTarget(product, variantDoc, blank, variantRow, design, renderTarget) {
  const placementProduct = mergePlacementSource(product, variantDoc);
  const savedProfile = resolveSavedBlankRenderProfile({
    blank,
    blankVariantId: variantRow.variantId,
    design,
    product: placementProduct,
    renderTarget,
  });
  if (!savedProfile || !savedProfile.garmentImageUrl || !savedProfile.resolvedDesignUrl) {
    throw new Error(`resolveSavedBlankRenderProfile failed for ${renderTarget}`);
  }
  const side = renderTarget === "flat_front" || renderTarget === "model_front" ? "front" : "back";
  const pkResolved =
    (savedProfile.placement && savedProfile.placement.placementId && String(savedProfile.placement.placementId).trim()) ||
    (side === "front" ? "front_center" : "back_center");

  const placementRow = getPlacementRowForSide(blank, side, pkResolved);
  if (!placementRow) throw new Error(`No placement row for ${side} ${pkResolved}`);

  const blankGarmentFam = getEffectiveColorFamilyForBlankPreview(variantRow.colorFamily, variantRow.colorName);
  const resolvedToneRef = savedProfile.resolvedTone || "dark";
  const renderTreatment = resolveBackRenderTreatment(blankGarmentFam, resolvedToneRef);
  let blend = savedProfile.engineBlend;
  if (renderTreatment === "blended") {
    const adj = resolveBlendedPreviewBlend8394(blankGarmentFam, resolvedToneRef, blend);
    blend = { blendMode: adj.blendMode, blendOpacity: adj.blendOpacity };
  }

  const tuning = tuningWithWarpEnabled(savedProfile.tuning, true);
  const effPl = savedProfile.placement;

  const fetchFn = typeof fetch === "function" ? fetch.bind(global) : null;
  if (!fetchFn) throw new Error("global.fetch required (Node 18+)");

  const blankResp = await fetchFn(savedProfile.garmentImageUrl);
  if (!blankResp.ok) throw new Error(`Garment HTTP ${blankResp.status}`);
  const blankBuffer = Buffer.from(await blankResp.arrayBuffer());

  const designResp = await fetchFn(savedProfile.resolvedDesignUrl);
  if (!designResp.ok) throw new Error(`Design HTTP ${designResp.status}`);
  const designBuffer = Buffer.from(await designResp.arrayBuffer());

  const renderSelectionLog = [];
  const { composeTelemetry } = await render8394DesignOnGarmentSharp({
    sharp,
    blankBuffer,
    designBuffer,
    tuning,
    blend,
    placementRow,
    effPl,
    variant: variantRow,
    target: renderTarget,
    renderTreatment,
    renderSelectionLog,
    debugArtifacts: null,
  });

  const layoutPlacement = buildLayoutPlacement(effPl, placementRow, tuning);

  return {
    renderTarget,
    renderTreatment,
    layoutPlacementSummary: {
      placementXY: { x: tuning.settings.placement.x, y: tuning.settings.placement.y },
      scale: tuning.settings.placement.scale,
      warpEnabled: tuning.settings.warp && tuning.settings.warp.enabled === true,
    },
    official8394StrictParity: composeTelemetry.official8394StrictParity,
  };
}

async function main() {
  const args = parseArgs();
  const productId = args.productId;
  const variantId = args.variantId;
  if (!productId || !variantId) {
    console.error("Required: --productId=... --variantId=...");
    process.exit(1);
  }

  const productSnap = await db.collection("rp_products").doc(productId).get();
  if (!productSnap.exists) throw new Error("Product not found");
  const product = productSnap.data();

  const variantSnap = await db.collection("rp_products").doc(productId).collection("variants").doc(variantId).get();
  if (!variantSnap.exists) throw new Error("Variant not found");
  const variantDoc = variantSnap.data();

  const blankId = product.blankId;
  if (!blankId) throw new Error("Product missing blankId");
  const blankSnap = await db.collection("rp_blanks").doc(blankId).get();
  if (!blankSnap.exists) throw new Error("Blank not found");
  const blank = blankSnap.data();

  const blankVariantId = variantDoc.blankVariantId || product.blankVariantId;
  if (!blankVariantId) throw new Error("Missing blankVariantId on variant/product");
  const variantRow = findBlankVariantById(blank, blankVariantId);
  if (!variantRow) throw new Error("Blank variant row not found");

  const designId =
    (variantDoc.designId && String(variantDoc.designId).trim()) ||
    (product.designId && String(product.designId).trim()) ||
    null;
  if (!designId) throw new Error("No designId on product/variant");
  const designSnap = await db.collection("designs").doc(designId).get();
  if (!designSnap.exists) throw new Error("Design not found");
  const design = designSnap.data();

  const flat = await runTarget(product, variantDoc, blank, variantRow, design, "flat_back");
  const model = await runTarget(product, variantDoc, blank, variantRow, design, "model_back");

  const out = {
    productId,
    variantId,
    note: "Warp forced on; blend/placement from saved profile (same as visible-center-matrix-real-proof).",
    flat_back: flat,
    model_back: model,
  };

  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
